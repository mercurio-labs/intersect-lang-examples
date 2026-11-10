use std::{fs, path::Path, process::Command};

const GOLDEN: &[u8] = include_bytes!("../../languages/petri/tests/golden/coffee.trace.json");

#[test]
fn coffee_cli_writes_the_golden_trace() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let trace = root.join("target/test-output/coffee-cli.trace.json");
    let output = Command::new(env!("CARGO_BIN_EXE_examples-run"))
        .current_dir(root)
        .args([
            "petri",
            "languages/petri/models/coffee.petri",
            "--scenario",
            "languages/petri/scenarios/two-coins.scenario.json",
            "--until",
            "20s",
            "--policy",
            "first",
            "--out",
        ])
        .arg(&trace)
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("cups=2"));
    assert_eq!(fs::read(trace)?, GOLDEN);
    Ok(())
}

#[test]
fn viewer_references_only_local_assets() {
    let html = include_str!("../../viewer/index.html");
    assert!(html.contains("src=\"viewer.js\""));
    assert!(html.contains("href=\"viewer.css\""));
    for file in [
        html,
        include_str!("../../viewer/viewer.js"),
        include_str!("../../viewer/viewer.css"),
    ] {
        assert!(!file.contains("http://") && !file.contains("https://"));
    }
}
