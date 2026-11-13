//! Handwritten walkthrough: authored definitions -> checked model -> timed run
//! -> saved trace -> replay, with a compiled-language-pack round trip.
use examples_petri::{DEFAULT_END_TIME, Scenario, TimedPetri, profile};
use examples_support::Source;
use intersect_run::{EndReason, Policy, Trace};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = Path::new("target/runs/petri-lifecycle");
    fs::create_dir_all(output)?;

    // 1. Supply source text and stable resource URIs. The language package owns
    // the Rcore metamodel, Xtext grammar, scope bindings and validation rules.
    let text = include_str!("../models/coffee.petri");
    let sources = [Source {
        uri: "coffee.petri".into(),
        text: text.into(),
    }];
    let scenario_text = include_str!("../scenarios/two-coins.scenario.json");

    // 2. Prepare the definitions, parse, link arc references in each net, and
    // validate structure and Rcore rules through the shared support loader.
    // See support/src/lib.rs for the individual frozen-engine operations.
    let loaded = examples_petri::load(&sources)?;
    for diagnostic in &loaded.diagnostics {
        eprintln!(
            "{:?}: {}: {}",
            diagnostic.location, diagnostic.issue.code, diagnostic.issue.message
        );
    }
    if loaded.has_errors() {
        return Err("Petri model failed validation; execution was not started".into());
    }

    // 3. Project the checked model into the language's execution semantics.
    // Place and arc identities still refer to the original source objects.
    let net = TimedPetri::from_loaded(&loaded)?;
    println!(
        "{}: {} places, {} transitions, {} checked objects",
        net.net().name,
        net.net().places.len(),
        net.net().transitions.len(),
        loaded.model.objects().len()
    );
    for place in &net.net().places {
        println!(
            "  {} ({}) starts with {} token(s)",
            place.name, place.id, place.tokens
        );
    }

    // 4. Choose explicit deterministic scheduling inputs, limits and policy.
    // The digest records which model text the trace describes.
    let settings = profile(Policy::First, 0, DEFAULT_END_TIME);
    let scenario: Scenario = serde_json::from_str(scenario_text)?;
    let digest = Some(format!("{:x}", Sha256::digest(text.as_bytes())));
    let (outcome, trace) = net.execute(&settings, scenario, digest.clone())?;
    let cups = net
        .net()
        .places
        .iter()
        .find(|p| p.name == "cups")
        .ok_or("Missing cups")?;
    if outcome.reason != EndReason::Quiescence
        || outcome.time != 6_000
        || outcome.state.tokens.get(&cups.id) != Some(&2)
    {
        return Err("The two-coins scenario did not produce two cups at 6000 ms".into());
    }
    println!("{:?} at {} ms: two cups", outcome.reason, outcome.time);

    // 5. Save and read the same versioned trace consumed by viewer/. Replaying
    // observations does not execute the model again or implement new semantics.
    let trace_path = output.join("coffee.trace.json");
    fs::write(&trace_path, serde_json::to_vec_pretty(&trace)?)?;
    let replay: Trace = serde_json::from_slice(&fs::read(&trace_path)?)?;
    if replay != trace {
        return Err("Trace serialization changed the recorded run".into());
    }
    for entry in &replay.entries {
        println!("  {:>5} ms  {:?}: {}", entry.time, entry.kind, entry.label);
    }

    // 6. Save a trusted host-local compiled language pack, then restore it with
    // the original model sources. Packs contain definitions, not run state.
    // Exact compiler/source identities and pack integrity are checked on load.
    let pack_path = output.join("petri.pack");
    fs::write(
        &pack_path,
        examples_support::build_pack(&examples_petri::LANGUAGE)?,
    )?;
    let restored =
        examples_support::load_pack(&examples_petri::LANGUAGE, fs::read(&pack_path)?, &sources)?;
    let restored_net = TimedPetri::from_loaded(&restored)?;
    let (_, restored_trace) =
        restored_net.execute(&settings, serde_json::from_str(scenario_text)?, digest)?;
    if restored_trace != trace {
        return Err("Restoring the language pack changed the trace".into());
    }
    println!("Pack round trip preserved the complete trace.");
    println!("Replay {} in viewer/.", trace_path.display());
    Ok(())
}
