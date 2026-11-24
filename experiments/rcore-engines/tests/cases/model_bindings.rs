use intersect_model::{api::ModelEdit, compile_rcore_at};
use intersect_run::TraceKind;
use rcore_engine_feasibility::{ModelBinding, run_model_source, run_source};
use serde_json::json;

const RESOURCE: &str = "memory:objects";

#[test]
fn original_airlock_metamodel_is_projected_by_rcore() -> Result<(), Box<dyn std::error::Error>> {
    let package = compile_rcore_at(
        "memory:airlock-schema.rcore",
        include_str!("../../../../languages/state-machine/language/machine.rcore"),
    )?;
    let mut model = package.new_model()?;
    model.create("airlock", "Machine", RESOURCE)?;
    model.set("airlock", "name", json!("Airlock"))?;
    for state in ["Sealed", "Access", "Ready", "Open", "Fault"] {
        model.create(state, "State", RESOURCE)?;
        model.set(state, "name", json!(state))?;
    }
    for event in ["unlock", "open", "close", "lock", "jam", "recover"] {
        model.create(event, "Event", RESOURCE)?;
        model.set(event, "name", json!(event))?;
    }
    for (index, (from, event, to)) in [
        ("Sealed", "unlock", "Access"),
        ("Ready", "open", "Open"),
        ("Open", "close", "Ready"),
        ("Ready", "lock", "Sealed"),
        ("Access", "jam", "Fault"),
        ("Fault", "recover", "Sealed"),
    ]
    .iter()
    .enumerate()
    {
        let id = format!("edge{index}");
        model.create(&id, "Transition", RESOURCE)?;
        model.set(&id, "source", json!(from))?;
        model.set(&id, "event", json!(event))?;
        model.set(&id, "target", json!(to))?;
    }
    model.set_many(&[
        ("airlock", "states", json!(["Sealed", "Access", "Fault"])),
        ("airlock", "initial", json!("Sealed")),
        (
            "airlock",
            "events",
            json!(["unlock", "open", "close", "lock", "jam", "recover"]),
        ),
        (
            "airlock",
            "transitions",
            json!(["edge0", "edge1", "edge2", "edge3", "edge4", "edge5"]),
        ),
        ("Access", "states", json!(["Ready", "Open"])),
        ("Access", "initial", json!("Ready")),
    ])?;
    let traces = run_model_source(
        "memory:airlock-profile.rcore",
        include_str!("../../profiles/airlock-model.rcore"),
        ModelBinding {
            definition: &package.prepared_definition(),
            model: &*model,
            root: "airlock",
        },
    )?;
    let prepared = run_source(
        "memory:airlock-flat.rcore",
        include_str!("../../profiles/airlock.rcore"),
    )?;
    assert_eq!(traces[0].trace.entries, prepared[0].trace.entries);
    assert!(traces[0].trace.entries.iter().any(|entry| {
        entry.kind == TraceKind::StepFired
            && entry
                .observation
                .as_ref()
                .is_some_and(|value| value["transition"] == "edge0")
    }));

    model.set("edge4", "target", json!("Sealed"))?;
    let edited = run_model_source(
        "memory:airlock-profile.rcore",
        include_str!("../../profiles/airlock-model.rcore"),
        ModelBinding {
            definition: &package.prepared_definition(),
            model: &*model,
            root: "airlock",
        },
    )?;
    assert_ne!(traces[0].trace.entries, edited[0].trace.entries);
    Ok(())
}

#[test]
fn a_different_metamodel_binds_to_the_same_state_machine() -> Result<(), Box<dyn std::error::Error>>
{
    let package = compile_rcore_at(
        "memory:maintenance-schema.rcore",
        include_str!("../../profiles/maintenance.metamodel.rcore"),
    )?;
    let mut model = package.new_model()?;
    model.create("job", "Job", RESOURCE)?;
    for phase in ["Pending", "Inspected", "Released"] {
        model.create(phase, "Phase", RESOURCE)?;
    }
    for (id, before, event, after) in [
        ("inspect", "Pending", "inspect", "Inspected"),
        ("premature", "Pending", "release", "Released"),
        ("approved", "Inspected", "release", "Released"),
    ] {
        model.create(id, "Advance", RESOURCE)?;
        model.set_many(&[
            (id, "before", json!(before)),
            (id, "command", json!(event)),
            (id, "after", json!(after)),
        ])?;
    }
    model.set_many(&[
        ("job", "phases", json!(["Pending", "Inspected", "Released"])),
        ("job", "start", json!("Pending")),
        (
            "job",
            "advances",
            json!(["inspect", "premature", "approved"]),
        ),
    ])?;
    let traces = run_model_source(
        "memory:maintenance-profile.rcore",
        include_str!("../../profiles/maintenance-model.rcore"),
        ModelBinding {
            definition: &package.prepared_definition(),
            model: &*model,
            root: "job",
        },
    )?;
    let trace = &traces[0].trace;
    assert_eq!(
        trace.header.profile.language_profile,
        "intersect.state-machine@1"
    );
    assert_eq!(
        trace
            .entries
            .iter()
            .filter(|entry| entry.kind == TraceKind::InputRejected)
            .count(),
        1
    );
    let last = trace
        .entries
        .iter()
        .rev()
        .find_map(|entry| entry.observation.as_ref())
        .unwrap();
    assert_eq!(last["active"], json!(["Released"]));
    Ok(())
}

#[test]
fn checked_petri_model_projects_to_the_existing_token_flow_engine()
-> Result<(), Box<dyn std::error::Error>> {
    let package = compile_rcore_at(
        "memory:petri-schema.rcore",
        include_str!("../../../../languages/petri/language/petri.rcore"),
    )?;
    let baseline: intersect_run::Trace = serde_json::from_str(include_str!(
        "../../../../languages/petri/tests/golden/coffee.trace.json"
    ))?;
    let net = baseline.header.metadata.language_data.as_ref().unwrap();
    let mut model = package.new_model()?;
    model.create("net", "Net", RESOURCE)?;
    model.set("net", "name", net["name"].clone())?;
    let mut place_ids = Vec::new();
    for row in net["places"].as_array().unwrap() {
        let id = row["id"].as_str().unwrap();
        model.create(id, "Place", RESOURCE)?;
        model.set(id, "name", row["name"].clone())?;
        if row["tokens"] != json!(0) {
            model.set(id, "tokens", row["tokens"].clone())?;
        }
        place_ids.push(id);
    }
    let mut transition_ids = Vec::new();
    for row in net["transitions"].as_array().unwrap() {
        let id = row["id"].as_str().unwrap();
        model.create(id, "Transition", RESOURCE)?;
        model.set(id, "name", row["name"].clone())?;
        if row["external"] == json!(true) {
            model.set(id, "external", json!(true))?;
        }
        if row["delay_ms"] != json!(0) {
            let delay = format!("{id}-delay");
            model.create(&delay, "Delay", RESOURCE)?;
            model.set_many(&[(&delay, "amount", json!(3)), (&delay, "unit", json!("s"))])?;
            model.set(id, "delay", json!(delay))?;
        }
        for direction in ["inputs", "outputs"] {
            let mut ids = Vec::new();
            for (index, arc) in row[direction].as_array().unwrap().iter().enumerate() {
                let arc_id = format!("{id}-{direction}-{index}");
                model.create(&arc_id, "Arc", RESOURCE)?;
                model.set(&arc_id, "place", arc["place"].clone())?;
                ids.push(arc_id);
            }
            model.set(id, direction, json!(ids))?;
        }
        transition_ids.push(id);
    }
    model.set_many(&[
        ("net", "places", json!(place_ids)),
        ("net", "transitions", json!(transition_ids)),
    ])?;
    let result = run_model_source(
        "memory:coffee-profile.rcore",
        include_str!("../../profiles/coffee-model.rcore"),
        ModelBinding {
            definition: &package.prepared_definition(),
            model: &*model,
            root: "net",
        },
    )?;
    assert_eq!(result[0].trace.entries, baseline.entries);
    assert_eq!(
        result[0].trace.header.metadata.language_data,
        baseline.header.metadata.language_data
    );
    Ok(())
}

#[test]
fn stopwatch_rcore_reads_commands_from_its_checked_metamodel()
-> Result<(), Box<dyn std::error::Error>> {
    let package = compile_rcore_at(
        "memory:watch-schema.rcore",
        include_str!("../../../../languages/stopwatch/language/stopwatch.rcore"),
    )?;
    let mut model = package.new_model()?;
    model.create("watch", "Script", RESOURCE)?;
    model.set("watch", "name", json!("Demo"))?;
    let mut commands = Vec::new();
    for (index, (kind, duration)) in [
        ("start", None),
        ("wait", Some((2, "s"))),
        ("stop", None),
        ("wait", Some((500, "ms"))),
        ("start", None),
        ("wait", Some((750, "ms"))),
        ("stop", None),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("command{index}");
        model.create(&id, "Command", RESOURCE)?;
        model.set(&id, "kind", json!(kind))?;
        if let Some((amount, unit)) = duration {
            model.set_many(&[(&id, "amount", json!(amount)), (&id, "unit", json!(unit))])?;
        }
        commands.push(id);
    }
    model.set("watch", "commands", json!(commands))?;
    let traces = run_model_source(
        "memory:watch-profile.rcore",
        include_str!("../../profiles/stopwatch-model.rcore"),
        ModelBinding {
            definition: &package.prepared_definition(),
            model: &*model,
            root: "watch",
        },
    )?;
    let flat = run_source(
        "memory:watch-flat.rcore",
        include_str!("../../profiles/stopwatch.rcore"),
    )?;
    assert_eq!(traces[0].trace.entries, flat[0].trace.entries);
    Ok(())
}
