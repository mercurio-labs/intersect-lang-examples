use super::{BuiltinEngine, DERIVATIVE_BUDGET_EXHAUSTED, Prepared, rcore};
use serde_json::json;

const OSCILLATOR: &str = include_str!("../profiles/oscillator.rcore");
const TANK: &str = include_str!("../profiles/tank-level.rcore");

#[test]
fn derivative_budget_is_shared_across_cases_and_reset_between_requests() {
    let source = OSCILLATOR
        .replace(
            "end_ms: 6000, sample_ms: 100, max_step_ms: 10",
            "end_ms: 1, sample_ms: 1, max_step_ms: 1",
        )
        .replace(
            r#"{name: "spring", parameters: {frequency: 1.0}}"#,
            r#"{name: "spring", parameters: {frequency: 1.0}},
               {name: "second", parameters: {frequency: 2.0}}"#,
        );
    let program = rcore::Program::new("memory:oscillator", &source, None).unwrap();
    let prepared = Prepared::new(&program, BuiltinEngine::Ode, Default::default()).unwrap();

    // Two cases times two derivatives times four RK4 stages.
    let failure = prepared
        .run_with_derivative_budget(&program, 15)
        .err()
        .expect("the second case should exhaust the same budget");
    assert_eq!(failure.to_string(), DERIVATIVE_BUDGET_EXHAUSTED);
    let first = prepared.run_with_derivative_budget(&program, 16).unwrap();
    let second = prepared.run_with_derivative_budget(&program, 16).unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].trace, second[0].trace);
    assert_eq!(first[1].trace, second[1].trace);
}

#[test]
fn crossing_localization_uses_the_request_derivative_budget() {
    let source = TANK.replace("end_ms: 4000", "end_ms: 2000");
    let program = rcore::Program::new("memory:tank", &source, None).unwrap();
    let prepared = Prepared::new(&program, BuiltinEngine::CoupledOde, Default::default()).unwrap();

    // The two integration steps fit. The first threshold probe consumes more work.
    let failure = prepared
        .run_with_derivative_budget(&program, 8)
        .err()
        .expect("threshold probes must also be charged");
    assert_eq!(failure.to_string(), DERIVATIVE_BUDGET_EXHAUSTED);
    let cases = prepared.run_with_derivative_budget(&program, 64).unwrap();
    assert!(cases[0].trace.entries.iter().any(|entry| {
        entry.time == 2_000
            && entry
                .observation
                .as_ref()
                .is_some_and(|observation| observation["crossed"] == json!(["full"]))
    }));
}

#[test]
fn preparation_rejects_sampling_that_cannot_fit_the_derivative_budget() {
    let source = OSCILLATOR.replace(
        "end_ms: 6000, sample_ms: 100, max_step_ms: 10",
        "end_ms: 409600, sample_ms: 100, max_step_ms: 1",
    );
    let program = rcore::Program::new("memory:oscillator", &source, None).unwrap();
    let failure = Prepared::new(&program, BuiltinEngine::Ode, Default::default())
        .err()
        .expect("the baseline estimate exceeds the budget");
    assert_eq!(
        failure.to_string(),
        "ODE sampling exceeds the derivative evaluation budget"
    );
}

#[test]
fn preparation_rejects_duplicate_crossing_events() {
    let source = TANK.replace(
        "rising: false, event: \"low\"",
        "rising: false, event: \"full\"",
    );
    let program = rcore::Program::new("memory:tank", &source, None).unwrap();
    let failure = Prepared::new(&program, BuiltinEngine::CoupledOde, Default::default())
        .err()
        .expect("one event cannot be delivered by two crossing monitors");
    assert_eq!(failure.to_string(), "Duplicate crossing event full");
}
