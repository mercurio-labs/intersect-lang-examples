use examples_web::{execute_petri, sample_model, sample_scenario};
use serde_json::Value;

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[test]
fn catalog_browser_resolves_cross_resource_targets() -> TestResult {
    let samples = examples_catalog::sample_sources();
    let result = examples_web::inspect_catalog(&samples[0].text, &samples[1].text)?;
    let objects = result["objects"].as_array().ok_or("Missing objects")?;
    assert_eq!(
        objects
            .iter()
            .map(|o| o["links"].as_array().map_or(0, Vec::len))
            .sum::<usize>(),
        9
    );
    assert!(objects.iter().any(|o| o["resource"] == "types.catalog"));
    assert!(examples_web::inspect_catalog(&samples[0].text, "not a catalog").is_err());
    Ok(())
}

#[test]
fn browser_coffee_matches_native_golden_entries() -> TestResult {
    let result = execute_petri(&sample_model(), &sample_scenario(), 20_000, "first", 0)?;
    let golden: Value = serde_json::from_str(include_str!(
        "../../languages/petri/tests/golden/coffee.trace.json"
    ))?;
    // Browser-specific work budgets differ; actual events and source identities
    // must be identical to the independently recorded CLI fixture.
    assert_eq!(result["trace"]["entries"], golden["entries"]);
    assert_eq!(result["summary"]["time_ms"], 6000);
    assert_eq!(result["summary"]["reason"], "Quiescence");
    assert!(
        result["summary"]["marking"]
            .as_array()
            .ok_or("Missing marking")?
            .iter()
            .any(|place| place["name"] == "cups" && place["tokens"] == 2)
    );
    Ok(())
}

#[test]
fn invalid_model_has_locations_and_cannot_execute() -> TestResult {
    let result = execute_petri(
        include_str!("../../languages/petri/models/invalid-weight.petri"),
        r#"{"inputs":[]}"#,
        20_000,
        "first",
        0,
    )?;
    assert!(result["trace"].is_null());
    let diagnostics = result["diagnostics"]
        .as_array()
        .ok_or("Missing diagnostics")?;
    assert!(!diagnostics.is_empty());
    assert_eq!(diagnostics[0]["resource"], "coffee.petri");
    assert!(diagnostics[0]["span"].is_array());
    Ok(())
}

#[test]
fn invalid_options_and_scenario_fail_before_loading() {
    assert!(execute_petri("", "{}", 0, "random", 0).is_err());
    assert!(execute_petri("", "{}", 3_600_001, "first", 0).is_err());
    assert!(execute_petri("", "not json", 0, "first", 0).is_err());
    assert!(execute_petri(&"x".repeat(65_537), "{}", 0, "first", 0).is_err());
}

#[test]
fn zero_delay_cycle_returns_a_budget_stop() -> TestResult {
    let result = execute_petri(
        include_str!("../../languages/petri/models/zeno.petri"),
        r#"{"inputs":[]}"#,
        20_000,
        "first",
        0,
    )?;
    assert_eq!(result["summary"]["reason"], "StepsPerInstant");
    assert_eq!(result["summary"]["steps"], 1000);
    Ok(())
}
