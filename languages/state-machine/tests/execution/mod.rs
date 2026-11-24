use intersect_example_state_machine::{Harness, SAMPLE, SCENARIO};
use intersect_run::TraceKind;

#[test]
fn checked_chart_and_run_share_state_and_transition_ids() -> Result<(), String> {
    let mut harness = Harness::new()?;
    let loaded = harness.load(SAMPLE)?;
    let scenario = serde_json::from_str::<Vec<String>>(SCENARIO).map_err(|e| e.to_string())?;
    let run = harness.run(&scenario)?;
    let names = run
        .frames
        .iter()
        .map(|frame| {
            frame
                .active
                .iter()
                .map(|state| state.name.as_str())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            vec!["Sealed"],
            vec!["Access", "Ready"],
            vec!["Access", "Open"],
            vec!["Access", "Open"],
            vec!["Access", "Ready"],
            vec!["Fault"],
            vec!["Sealed"],
        ]
    );
    let graph = &loaded["scene"]["scene"];
    assert_eq!(graph["edges"].as_array().map(Vec::len), Some(6), "{graph}");
    assert_eq!(
        graph["problems"].as_array().map(Vec::len),
        Some(0),
        "{graph}"
    );
    let edge_ids = graph["edges"]
        .as_array()
        .ok_or("Missing edges")?
        .iter()
        .filter_map(|edge| edge["binding"]["elementId"].as_str())
        .collect::<Vec<_>>();
    for frame in &run.frames {
        if let Some(id) = &frame.transition {
            assert!(edge_ids.contains(&id.as_str()));
        }
    }
    assert_eq!(run.frames[3].outcome, "rejected");
    assert!(run.frames[3].transition.is_none());
    assert_eq!(run.trace.header.format, "intersect.run.trace.v1");
    assert_eq!(
        run.trace
            .entries
            .iter()
            .filter(|entry| entry.kind == TraceKind::StepFired)
            .count(),
        5
    );
    assert_eq!(run.trace, harness.run(&scenario)?.trace);
    Ok(())
}

#[test]
fn model_errors_revoke_execution_and_leaf_transitions_take_priority() -> Result<(), String> {
    let mut harness = Harness::new()?;
    let text = SAMPLE.replace(
        "transition Access on jam -> Fault;",
        "transition Access on jam -> Fault;\n  transition Open on jam -> Ready;",
    );
    harness.load(&text)?;
    let run = harness.run(&["unlock".into(), "open".into(), "jam".into(), "typo".into()])?;
    assert_eq!(
        run.frames[3].active.last().map(|state| state.name.as_str()),
        Some("Ready")
    );
    assert_eq!(run.frames[4].outcome, "rejected");
    for invalid in [
        text.replace("initial Ready", "initial Sealed"),
        text.replace("state Access initial Ready", "state Access"),
        text.replace(
            "transition Open on jam -> Ready;",
            "transition Ready on open -> Fault;",
        ),
    ] {
        assert!(harness.load(&invalid).is_err(), "{invalid}");
        assert!(harness.run(&[]).is_err());
    }
    Ok(())
}
