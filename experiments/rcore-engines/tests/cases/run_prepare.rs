use intersect_run::TraceKind;
use rcore_engine_feasibility::{
    RunInputs, TimedEvent, check_builtin_engine, prepare_declared_profile,
};
use serde_json::json;
use std::collections::BTreeMap;

const TANK: &str = include_str!("../../profiles/tank-level.rcore");
const CATALOG_ODE: &str = "intersect.coupled-ode@1";
const CATALOG_CHART: &str = "intersect.state-machine@1";

#[test]
fn declared_engine_authorizes_preparation_and_request_events() {
    let source = r#"rcore 1;
        package test.lock version "1";
        pub fn engine() -> String = "intersect.unknown@1";
        pub fn chart() -> {
          initial: String, states: Sequence<{id: String}>,
          transitions: Sequence<{from: String, event: String, to: String}>
        } = {
          initial: "Locked", states: [{id: "Locked"}, {id: "Unlocked"}],
          transitions: [{from: "Locked", event: "open", to: "Unlocked"}]
        };"#;
    let inputs = RunInputs {
        events: Some(vec![
            TimedEvent {
                at: 1,
                event: "unknown".into(),
            },
            TimedEvent {
                at: 2,
                event: "open".into(),
            },
        ]),
        ..Default::default()
    };
    let prepared =
        prepare_declared_profile("memory:lock", source, CATALOG_CHART, None, inputs).unwrap();
    let first = &prepared.run().unwrap()[0].trace;
    assert_eq!(first.header.profile.language_profile, CATALOG_CHART);
    assert!(
        first
            .entries
            .iter()
            .any(|entry| entry.kind == TraceKind::InputRejected)
    );
    let transition = first
        .entries
        .iter()
        .find(|entry| entry.kind == TraceKind::StepFired)
        .unwrap();
    assert_eq!(
        transition.observation.as_ref().unwrap()["active"],
        json!(["Unlocked"])
    );
    assert_eq!(*first, prepared.run().unwrap()[0].trace);
}

#[test]
fn declared_profiles_check_engine_and_typed_wiring_before_running() {
    assert!(check_builtin_engine(CATALOG_ODE).is_ok());
    assert!(check_builtin_engine("intersect.coupled-ode@2").is_err());
    // This engine is known to the shared catalog and installed by the SysML host.
    assert!(check_builtin_engine("intersect.scalar-affine@1").is_err());
    let unsupported = prepare_declared_profile(
        "memory:bad",
        "",
        "intersect.coupled-ode@2",
        None,
        RunInputs::default(),
    );
    assert!(
        unsupported
            .err()
            .unwrap()
            .to_string()
            .contains("unavailable")
    );

    for (source, expected) in [
        (
            TANK.replace("active.Filling", "active.Unknown"),
            "Invalid derivative binding",
        ),
        (
            TANK.replace("variable: \"level\"", "variable: \"absent\""),
            "Unknown monitor variable",
        ),
        (
            TANK.replace(
                "rising: true, event: \"full\"",
                "rising: true, event: \"missing\"",
            ),
            "Unbound crossing event",
        ),
        (
            TANK.replace("active.Filling", "parameter.inflow"),
            "Engine callback must have signature",
        ),
        (
            TANK.replace("parameter.outflow", "parameter.undefined"),
            "missing parameter undefined",
        ),
        (
            TANK.replace("to: \"Draining\"", "to: \"Undefined\""),
            "Unknown target state",
        ),
    ] {
        let result = prepare_declared_profile(
            "memory:tank",
            &source,
            CATALOG_ODE,
            None,
            RunInputs::default(),
        );
        let diagnostic = result.err().unwrap().to_string();
        assert!(diagnostic.contains(expected), "{diagnostic}");
    }
}

#[test]
fn declared_numeric_inputs_override_known_cases_and_parameters() {
    let source = TANK.replace(
        "pub fn engine() -> String = \"intersect.coupled-ode@1\";",
        "",
    );
    let input = |case: &str, name: &str, value| RunInputs {
        parameters: BTreeMap::from([(case.into(), BTreeMap::from([(name.into(), value)]))]),
        ..Default::default()
    };
    let prepare =
        |inputs| prepare_declared_profile("memory:tank", &source, CATALOG_ODE, None, inputs);
    let original = prepare(RunInputs::default()).unwrap().run().unwrap();
    let updated = prepare(input("tank", "inflow", 3.0))
        .unwrap()
        .run()
        .unwrap();
    let opening_tick = |cases: &[rcore_engine_feasibility::CaseTrace]| {
        cases[0]
            .trace
            .entries
            .iter()
            .find(|entry| {
                entry
                    .observation
                    .as_ref()
                    .is_some_and(|observed| observed["crossed"] == json!(["full"]))
            })
            .unwrap()
            .time
    };
    assert_eq!(opening_tick(&original), 2_000);
    assert_eq!(opening_tick(&updated), 1_000);
    for (inputs, expected) in [
        (input("unknown-case", "inflow", 3.0), "Unknown ODE case"),
        (input("tank", "unknown-parameter", 3.0), "Unknown parameter"),
        (input("tank", "inflow", f64::INFINITY), "must be finite"),
        (
            RunInputs {
                events: Some(vec![]),
                ..Default::default()
            },
            "does not accept a scenario event override",
        ),
    ] {
        let diagnostic = prepare(inputs).err().unwrap().to_string();
        assert!(diagnostic.contains(expected), "{diagnostic}");
    }
}
