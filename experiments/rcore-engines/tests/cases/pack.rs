use rcore_engine_feasibility::pack::{self, Archive, RunRequest};

const DEFINITION: &str = r#"
rcore 1;
package example.items version "1";
metamodel "urn:intersect:test:items" prefix m {
  class Item {}
}
"#;

const MANIFEST: &str = r#"
[package]
package_id = "example.items"
release = "1"
display_name = "Items"
description = "Structure-only example"

[definitions]
namespace = "urn:intersect:test:items"
metamodel = "items.rcore"
"#;

fn read(path: &str) -> Result<String, String> {
    match path {
        "items.rcore" => Ok(DEFINITION.into()),
        "execution/oscillator.rcore" => Ok(include_str!("../../profiles/oscillator.rcore").into()),
        _ => Err(format!("Missing source {path:?}")),
    }
}

#[test]
fn manifest_without_execution_keeps_the_existing_archive_format() -> Result<(), String> {
    let archive = pack::build(MANIFEST, read)?;
    let opened = archive.inspect()?;
    assert_eq!(opened["format_version"], 2);
    assert!(opened.get("execution").is_none());
    let archive = pack::build(MANIFEST, read)?;
    let issue = archive
        .check(RunRequest::default())
        .err()
        .ok_or("Expected a diagnostic for absent execution")?;
    assert!(issue.contains("no execution profiles"), "{issue}");
    Ok(())
}

#[test]
fn authored_and_resolved_execution_profiles_keep_their_own_contract() -> Result<(), String> {
    let execution = r#"
[execution.profiles.oscillator]
engine = "intersect.ode@1"
source = "execution/oscillator.rcore"
"#;
    let manifest = format!("{MANIFEST}{execution}");
    let archive = pack::build(&manifest, read)?;
    let opened = archive.inspect()?;
    let base = pack::build(MANIFEST, read)?.inspect()?;
    assert_eq!(opened["schema_revision"], base["schema_revision"]);
    assert_ne!(opened["revision"], base["revision"]);
    assert_eq!(opened["format_version"], 3);

    let absent_selection = pack::build(&manifest, read)?
        .check(RunRequest::default())
        .err()
        .ok_or("Expected a diagnostic for absent selection")?;
    assert!(
        absent_selection.contains("Choose an execution profile"),
        "{absent_selection}"
    );
    let result = pack::build(&manifest, read)?.check(RunRequest {
        profile: Some("oscillator".into()),
        ..RunRequest::default()
    })?;
    assert_eq!(result.provenance.profile, "oscillator");
    assert_eq!(result.provenance.engine, "intersect.ode@1");

    let unsupported = pack::build(
        &manifest.replace("intersect.ode@1", "intersect.ode@9"),
        read,
    )
    .err()
    .ok_or("Expected a diagnostic for unavailable catalog engine")?;
    assert!(
        unsupported.contains("Engine intersect.ode@9 is unavailable"),
        "{unsupported}"
    );
    Ok(())
}

#[test]
fn archive_transport_refuses_duplicate_paths() {
    let result = serde_json::from_str::<Archive>(r#"{"manifest.json":"a","manifest.json":"b"}"#);
    let issue = result.err().expect("duplicate path must fail");
    assert!(
        issue
            .to_string()
            .contains("Duplicate language archive path")
    );
}

#[test]
fn preparation_checks_deferred_ticks_and_preserves_immediate_input_order() -> Result<(), String> {
    let manifest = format!(
        "{MANIFEST}\n[execution]\ndefault = 'chart'\n[execution.profiles.chart]\nengine = 'intersect.state-machine@1'\nsource = 'execution/chart.rcore'\n"
    );
    let chart = r#"rcore 1;
        package test.chart version "1";
        pub fn chart() -> {
          initial: String, states: Sequence<{id: String}>, immediate: Bool,
          transitions: Sequence<{from: String, event: String, to: String}>
        } = {
          initial: "A", states: [{id: "A"}, {id: "B"}, {id: "C"}], immediate: false,
          transitions: [{from: "A", event: "next", to: "B"},
                        {from: "B", event: "finish", to: "C"}]
        };
        pub fn scenario() -> Sequence<{at: Int, event: String}> =
          [{at: 10, event: "next"}, {at: 10, event: "finish"}];"#;
    let build = |source: &str| {
        pack::build(&manifest, |path| match path {
            "execution/chart.rcore" => Ok(source.into()),
            _ => read(path),
        })
    };
    let issue = build(chart)?
        .check(RunRequest::default())
        .err()
        .ok_or("Expected deferred same-tick events to fail preparation")?;
    assert!(issue.contains("Deferred chart events need distinct ticks"));

    let immediate = chart.replace("immediate: false", "immediate: true");
    build(&immediate)?.check(RunRequest::default())?;
    let result = build(&immediate)?.run(RunRequest::default())?;
    let states = result.cases[0]
        .trace
        .entries
        .iter()
        .filter(|entry| entry.kind == intersect_run::TraceKind::EventDelivered)
        .filter_map(|entry| entry.observation.as_ref().map(|state| &state["active"]))
        .collect::<Vec<_>>();
    assert_eq!(
        states,
        [&serde_json::json!(["B"]), &serde_json::json!(["C"])]
    );
    Ok(())
}
