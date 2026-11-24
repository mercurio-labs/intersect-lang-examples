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
