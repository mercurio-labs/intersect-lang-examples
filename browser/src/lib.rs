//! Handwritten browser adapter. Parsing, validation and firing remain in the
//! language package and Intersect; JavaScript only edits inputs and replays traces.
use examples_petri::{Scenario, TimedPetri, profile};
use examples_support::Source;
use intersect_run::Policy;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const MAX_MODEL_BYTES: usize = 64 * 1024;
pub const MAX_SCENARIO_BYTES: usize = 64 * 1024;
pub const MAX_INPUTS: usize = 1_000;
pub const MAX_END_TIME: u32 = 3_600_000;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn stopwatch_sources() -> String {
    json!({"text":examples_stopwatch::SAMPLE,"rcore":examples_stopwatch::RCORE}).to_string()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn run_stopwatch(text: &str) -> Result<String, wasm_bindgen::JsValue> {
    examples_stopwatch::run(text)
        .map(|v| v.to_string())
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn catalog_samples() -> String {
    json!(
        examples_catalog::sample_sources()
            .iter()
            .map(|s| &s.text)
            .collect::<Vec<_>>()
    )
    .to_string()
}

pub fn inspect_catalog(types: &str, shop: &str) -> Result<Value, String> {
    if types.len() > MAX_MODEL_BYTES || shop.len() > MAX_MODEL_BYTES {
        return Err("Each resource must be at most 64 KiB".into());
    }
    let loaded = examples_support::load(
        &examples_catalog::LANGUAGE,
        &[
            Source {
                uri: "types.catalog".into(),
                text: types.into(),
            },
            Source {
                uri: "shop.catalog".into(),
                text: shop.into(),
            },
        ],
    )?;
    if loaded.has_errors() {
        return Err(format!("{:?}", loaded.diagnostics));
    }
    let objects: Vec<_> = loaded.model.objects().map(|object| {
        let links: Vec<_> = ["type", "superType"].into_iter().flat_map(|name| {
            object.feature(name).into_iter().flat_map(move |feature| {
                object.refs(feature).map(move |target| json!({"feature": name, "target": target.identity()}))
            })
        }).collect();
        json!({"id": object.identity(), "class": object.class_key(), "resource": object.resource(),
            "name": object.feature("name").and_then(|f| object.str(f)), "links": links})
    }).collect();
    Ok(json!({"objects":objects}))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn check_catalog(types: &str, shop: &str) -> Result<String, wasm_bindgen::JsValue> {
    inspect_catalog(types, shop)
        .map(|v| v.to_string())
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn sample_model() -> String {
    include_str!("../../languages/petri/models/coffee.petri").into()
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn sample_scenario() -> String {
    include_str!("../../languages/petri/scenarios/two-coins.scenario.json").into()
}

/// Execute an edited model, returning the same trace format as `examples-run`.
/// Model-rule failures return located diagnostics without a trace. Syntax,
/// linking, malformed scenario and option errors return an error to the host.
pub fn execute_petri(
    model: &str,
    scenario: &str,
    until_ms: u32,
    policy: &str,
    seed: u32,
) -> Result<Value, String> {
    if model.len() > MAX_MODEL_BYTES || scenario.len() > MAX_SCENARIO_BYTES {
        return Err("Model and scenario must each be at most 64 KiB".into());
    }
    if until_ms > MAX_END_TIME {
        return Err("End time must be at most 3600000 ms (one hour)".into());
    }
    let policy = match policy {
        "first" => Policy::First,
        "seeded" => Policy::Seeded,
        _ => return Err("Policy must be first or seeded".into()),
    };
    let scenario: Scenario =
        serde_json::from_str(scenario).map_err(|error| format!("Scenario JSON: {error}"))?;
    if scenario.inputs.len() > MAX_INPUTS {
        return Err("Scenario must contain at most 1000 inputs".into());
    }
    let loaded = examples_petri::load(&[Source {
        // Stable URI gives native coffee traces and browser traces the same IDs.
        uri: "coffee.petri".into(),
        text: model.into(),
    }])?;
    let diagnostics: Vec<_> = loaded
        .diagnostics
        .iter()
        .map(|diagnostic| {
            json!({
                "severity": format!("{:?}", diagnostic.issue.severity),
                "code": diagnostic.issue.code,
                "message": diagnostic.issue.message,
                "resource": diagnostic.location.as_ref().map(|location| &location.resource),
                "span": diagnostic.location.as_ref().and_then(|location| location.span),
            })
        })
        .collect();
    if loaded.has_errors() {
        return Ok(json!({"trace": null, "summary": null, "diagnostics": diagnostics}));
    }
    let net = TimedPetri::from_loaded(&loaded).map_err(|error| error.to_string())?;
    let mut profile = profile(policy, seed.into(), until_ms.into());
    // A browser run retains every observation. Bound trace growth independently
    // of simulated time; the UI also runs this adapter in a disposable worker.
    profile.budgets.total_steps = 10_000;
    profile.budgets.events = 10_000;
    let digest = format!("{:x}", Sha256::digest(model.as_bytes()));
    let (outcome, trace) = net
        .execute(&profile, scenario, Some(digest))
        .map_err(|error| error.to_string())?;
    let marking: Vec<_> = net
        .net()
        .places
        .iter()
        .map(|place| json!({"name": place.name, "tokens": outcome.state.tokens.get(&place.id)}))
        .collect();
    Ok(json!({
        "trace": trace,
        "summary": {
            "reason": format!("{:?}", outcome.reason),
            "time_ms": outcome.time,
            "steps": outcome.steps,
            "marking": marking,
        },
        "diagnostics": diagnostics,
    }))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn run_petri(
    model: &str,
    scenario: &str,
    until_ms: u32,
    policy: &str,
    seed: u32,
) -> Result<String, wasm_bindgen::JsValue> {
    execute_petri(model, scenario, until_ms, policy, seed)
        .and_then(|result| serde_json::to_string(&result).map_err(|error| error.to_string()))
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}
