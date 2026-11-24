use intersect_run::{Trace, TraceKind};
use rcore_engine_feasibility::{CaseTrace, run_source};
use serde_json::{Value, json};

fn run(name: &str) -> Vec<CaseTrace> {
    let path = format!("profiles/{name}.rcore");
    let source = std::fs::read_to_string(&path).unwrap();
    run_source(&path, &source).unwrap()
}

fn observations(trace: &Trace) -> impl Iterator<Item = (u64, &Value)> {
    trace
        .entries
        .iter()
        .filter_map(|entry| Some((entry.time, entry.observation.as_ref()?)))
}

#[test]
fn airlock_nested_route_matches_existing_demo() {
    let traces = run("airlock");
    let trace = &traces[0].trace;
    let fired: Vec<_> = trace
        .entries
        .iter()
        .filter(|entry| {
            matches!(
                entry.kind,
                TraceKind::RunStart | TraceKind::StepFired | TraceKind::InputRejected
            )
        })
        .map(|entry| entry.observation.as_ref().unwrap()["active"].clone())
        .collect();
    assert_eq!(
        fired,
        [
            json!(["Sealed"]),
            json!(["Access", "Ready"]),
            json!(["Access", "Open"]),
            json!(["Access", "Open"]),
            json!(["Access", "Ready"]),
            json!(["Fault"]),
            json!(["Sealed"]),
        ]
    );
    assert_eq!(
        trace
            .entries
            .iter()
            .filter(|row| row.kind == TraceKind::InputRejected)
            .count(),
        1
    );
    assert_eq!(*trace, run("airlock")[0].trace);
}

#[test]
fn stopwatch_measures_only_time_in_running_mode() {
    let traces = run("stopwatch");
    let trace = &traces[0].trace;
    let observed: Vec<_> = observations(trace)
        .map(|(at, value)| {
            (
                at,
                value["active"][0].as_str().unwrap(),
                value["elapsed"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        observed,
        [
            (0, "idle", 0),
            (0, "running", 0),
            (0, "running", 0),
            (2000, "stopped", 2000),
            (2000, "stopped", 2000),
            (2500, "running", 2000),
            (2500, "running", 2000),
            (3250, "stopped", 2750),
            (3250, "stopped", 2750),
        ]
    );

    let source = include_str!("../../profiles/stopwatch.rcore");
    let invalid = source.replace("{at: 0, event: \"start\"}", "{at: 0, event: \"stop\"}");
    let rejected = run_source("memory:rejected.rcore", &invalid).unwrap();
    assert_eq!(
        rejected[0]
            .trace
            .entries
            .iter()
            .filter(|row| row.kind == TraceKind::InputRejected)
            .count(),
        2
    );
}

#[test]
fn petri_preserves_checked_demo_event_traces() {
    for (name, expected) in [
        (
            "coffee",
            include_str!("../../../../languages/petri/tests/golden/coffee.trace.json"),
        ),
        (
            "conflict-seeded",
            include_str!("../../../../languages/petri/tests/golden/conflict-seeded.trace.json"),
        ),
    ] {
        let expected: Trace = serde_json::from_str(expected).unwrap();
        let traces = run(name);
        let actual = &traces[0].trace;
        assert_eq!(actual.entries, expected.entries);
        assert_eq!(actual.header.profile, expected.header.profile);
        assert_eq!(
            actual.header.metadata.language_data,
            expected.header.metadata.language_data
        );
        assert_ne!(
            actual.header.metadata.model_digest,
            expected.header.metadata.model_digest
        );
    }
    let traces = run("zeno");
    let last = traces[0].trace.entries.last().unwrap();
    assert_eq!(last.label, "StepsPerInstant");
    assert_eq!(last.time, 0);
}

#[test]
fn petri_refuses_oversized_retained_observations() {
    let source = include_str!("../../profiles/zeno.rcore")
        .replace("\"a\"", &format!("\"{}\"", "a".repeat(8 * 1024)));
    let result = run_source("memory:petri-oversized-trace.rcore", &source);
    assert!(matches!(
        result,
        Err(intersect_run::RunError::Semantics(message))
            if message.contains("Petri trace observation byte limit exceeded")
    ));
}

#[test]
fn new_service_domain_reuses_timed_token_flow() {
    let traces = run("service-desk");
    let trace = &traces[0].trace;
    let (last, observed) = observations(trace).last().unwrap();
    assert_eq!(last, 1200);
    assert_eq!(
        observed["marking"],
        json!({"waiting":0,"served":3,"agent":1})
    );
    let at_same_tick: Vec<_> = trace
        .entries
        .iter()
        .filter(|entry| entry.time == 400 && entry.kind == TraceKind::EventDelivered)
        .map(|entry| entry.label.as_str())
        .collect();
    assert_eq!(at_same_tick, ["complete serve", "input arrival"]);
}

#[test]
fn heater_matches_closed_form_on_the_demo_sample_grid() {
    let cases = run("heated-enclosure");
    for (case, power) in cases.iter().zip([120.0, 250.0]) {
        let samples: Vec<_> = observations(&case.trace).collect();
        assert_eq!(samples.len(), 121);
        for (index, (at, observation)) in samples.iter().enumerate() {
            assert_eq!(*at, index as u64 * 15_000);
            let seconds = *at as f64 / 1_000.0;
            let expected = 20.0 - power / 5.0 * (-5.0 * seconds / 1200.0).exp_m1();
            let actual = observation["values"]["temperatureC"].as_f64().unwrap();
            assert!(
                (actual - expected).abs() < 2e-8,
                "{case_id} at {at}",
                case_id = case.case
            );
        }
    }
}

#[test]
fn thermostat_delivers_crossings_between_regular_samples() {
    let cases = run("thermostat");
    assert_eq!(cases.len(), 2);
    for (case, (power, crossing_count)) in cases.iter().zip([(120.0, 23), (250.0, 83)]) {
        let mut events = Vec::new();
        let mut samples = Vec::new();
        for (at, value) in observations(&case.trace) {
            if value["sample"].as_bool() == Some(true) {
                samples.push(at);
            }
            if !value["crossed"].as_array().unwrap().is_empty() {
                events.push((at, value));
            }
        }
        assert_eq!(samples, (0..=1_800_000).step_by(15_000).collect::<Vec<_>>());
        assert_eq!(events.len(), crossing_count);
        let (mut previous_time, mut previous_temperature) = (0, 20.0);
        for (index, (at, value)) in events.iter().enumerate() {
            let turning_off = index % 2 == 0;
            let (name, mode, expected) = if turning_off {
                ("tooHot", "Idle", 40.0)
            } else {
                ("tooCool", "Heating", 38.0)
            };
            assert_eq!(value["crossed"], json!([name]));
            assert_eq!(value["mode"], mode);
            let actual = value["values"]["temperatureC"].as_f64().unwrap();
            assert!(
                (actual - expected).abs() < 0.0002,
                "crossing at {at}: {actual}"
            );
            let equilibrium = 20.0 + if turning_off { power / 5.0 } else { 0.0 };
            let expected_seconds =
                -240.0 * ((expected - equilibrium) / (previous_temperature - equilibrium)).ln();
            let elapsed_seconds = (*at - previous_time) as f64 / 1_000.0;
            assert!(
                (elapsed_seconds - expected_seconds).abs() < 0.0011,
                "{} crossing {index} at {at} ms: {elapsed_seconds} s, expected {expected_seconds} s",
                case.case
            );
            (previous_time, previous_temperature) = (*at, actual);
        }
        assert_ne!(events[0].0 % 15_000, 0);
    }
}

#[test]
fn oscillator_reuses_ode_with_coupled_state_variables() {
    let traces = run("oscillator");
    let samples: Vec<_> = observations(&traces[0].trace).collect();
    assert_eq!(samples.len(), 61);
    for (at, observation) in samples {
        let seconds = at as f64 / 1_000.0;
        let position = observation["values"]["position"].as_f64().unwrap();
        let velocity = observation["values"]["velocity"].as_f64().unwrap();
        assert!((position - seconds.cos()).abs() < 6e-10);
        assert!((velocity + seconds.sin()).abs() < 6e-10);
    }
}

#[test]
fn runtime_sources_can_change_behavior_and_reject_bad_bindings() {
    let source = include_str!("../../profiles/oscillator.rcore");
    let original = run_source("memory:spring.rcore", source).unwrap();
    let edited = run_source(
        "memory:spring.rcore",
        &source.replace("frequency: 1.0", "frequency: 2.0"),
    )
    .unwrap();
    assert_ne!(
        original[0].trace.header.metadata.model_digest,
        edited[0].trace.header.metadata.model_digest
    );
    assert_ne!(original[0].trace.entries, edited[0].trace.entries);

    for (bad, expected) in [
        (
            source.replace("intersect.ode@1", "intersect.ode@99"),
            "unavailable",
        ),
        (
            source.replace("state.velocity", "state.unknown"),
            "Invalid derivative binding",
        ),
        (
            source
                .replace(
                    "positionRate(velocity: Float64)",
                    "positionRate(velocity: Bool)",
                )
                .replace("= velocity;", "= if velocity { 1.0 } else { 0.0 };"),
            "Engine callback",
        ),
    ] {
        let issue = run_source("memory:bad.rcore", &bad).err().unwrap();
        assert!(issue.to_string().contains(expected), "{issue}");
    }
}

#[test]
fn thermal_equilibrium_uses_the_same_runtime_rcore_loading_for_bisection() {
    let source = include_str!("../../profiles/thermal-equilibrium.rcore");
    let solve =
        |source| rcore_engine_feasibility::solve_root_source("memory:equilibrium.rcore", source);
    let solved = solve(source).unwrap();
    assert_eq!(solved.len(), 2);
    for (solution, (case, expected)) in solved.iter().zip([("baseline", 44.0), ("current", 70.0)]) {
        assert_eq!(solution.case, case);
        assert!((solution.root - expected).abs() < 1e-8);
    }
    let no_root = source.replace("[120.0, 5.0, 20.0]", "[120.0, 0.0, 20.0]");
    assert!(
        solve(&no_root)
            .err()
            .unwrap()
            .to_string()
            .contains("same sign")
    );
}

#[test]
fn liquid_level_controller_reuses_the_coupler_and_switches_before_same_tick_samples() {
    let cases = run("tank-level");
    let trace = &cases[0].trace;
    assert_eq!(*trace, run("tank-level")[0].trace);
    let sampled: Vec<_> = observations(trace)
        .filter(|(_, value)| value["sample"] == json!(true))
        .collect();
    assert_eq!(sampled.len(), 5);
    for ((at, value), (expected_time, level, mode, events)) in sampled.iter().zip([
        (0, 0.0, "Filling", json!([])),
        (1000, 1.0, "Filling", json!([])),
        (2000, 2.0, "Draining", json!(["full"])),
        (3000, 1.0, "Filling", json!(["low"])),
        (4000, 2.0, "Draining", json!(["full"])),
    ]) {
        assert_eq!(*at, expected_time);
        assert_eq!(value["mode"], mode);
        assert_eq!(value["crossed"], events);
        assert!((value["values"]["level"].as_f64().unwrap() - level).abs() < 1e-12);
    }
}
