use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

const GOLDEN: &[u8] = include_bytes!("../../languages/petri/tests/golden/coffee.trace.json");

fn command(work: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_examples-run"));
    command.current_dir(work);
    command
}

fn successful(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn catalog_pack_checks_in_a_fresh_process_and_refuses_corruption()
-> Result<(), Box<dyn std::error::Error>> {
    let work = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/test-output/catalog-pack");
    fs::create_dir_all(&work)?;
    successful(
        command(&work)
            .args(["pack", "catalog", "catalog.pack"])
            .output()?,
    );
    successful(
        command(&work)
            .args(["pack", "catalog", "repeated.pack"])
            .output()?,
    );
    let mut bytes = fs::read(work.join("catalog.pack"))?;
    assert_eq!(bytes, fs::read(work.join("repeated.pack"))?);

    let checked = successful(
        command(&work)
            .args(["catalog", "check", "--pack", "catalog.pack"])
            .output()?,
    );
    assert!(checked.contains("Loaded compiled pack"));
    assert!(checked.contains("Catalog checked 21 objects."));

    let last = bytes.last_mut().ok_or("Empty compiled pack")?;
    *last ^= 1;
    fs::write(work.join("corrupt.pack"), bytes)?;
    let corrupt = command(&work)
        .args(["catalog", "check", "--pack", "corrupt.pack"])
        .output()?;
    assert!(
        !corrupt.status.success(),
        "A corrupt pack must fail without recompiling"
    );
    assert!(String::from_utf8_lossy(&corrupt.stderr).contains("digest"));
    Ok(())
}

#[test]
fn petri_pack_reproduces_coffee_golden_in_a_fresh_process() -> Result<(), Box<dyn std::error::Error>>
{
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let work = root.join("target/test-output/petri-pack");
    fs::create_dir_all(&work)?;
    successful(
        command(&work)
            .args(["pack", "petri", "petri.pack"])
            .output()?,
    );
    let run = successful(
        command(&work)
            .arg("petri")
            .arg(root.join("languages/petri/models/coffee.petri"))
            .arg("--scenario")
            .arg(root.join("languages/petri/scenarios/two-coins.scenario.json"))
            .args([
                "--pack",
                "petri.pack",
                "--until",
                "20s",
                "--policy",
                "first",
                "--out",
                "coffee.trace.json",
            ])
            .output()?,
    );
    assert!(run.contains("Loaded compiled pack"));
    assert!(run.contains("cups=2"));
    assert_eq!(fs::read(work.join("coffee.trace.json"))?, GOLDEN);

    let invalid = command(&work)
        .arg("petri")
        .arg(root.join("languages/petri/models/invalid-weight.petri"))
        .args(["--pack", "petri.pack", "--out", "invalid.trace.json"])
        .output()?;
    assert!(!invalid.status.success());
    let diagnostic = String::from_utf8_lossy(&invalid.stderr);
    assert!(diagnostic.contains("invalid-weight.petri:"));
    assert!(diagnostic.contains("petri.arc.weight"));

    let wrong = command(&work)
        .args(["catalog", "check", "--pack", "petri.pack"])
        .output()?;
    assert!(!wrong.status.success());
    assert!(String::from_utf8_lossy(&wrong.stderr).contains("Pack language"));
    Ok(())
}
