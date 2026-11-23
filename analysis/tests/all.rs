use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "intersect-analysis-tests-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn runner() -> Command {
    Command::new(env!("CARGO_BIN_EXE_intersect-analysis"))
}

fn fixture(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("examples")
        .join(path)
}

fn status(output: Output, code: i32) {
    assert_eq!(
        output.status.code(),
        Some(code),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn package(language: &str, scratch: &Scratch) -> PathBuf {
    let source = fixture(language);
    let pack = scratch.file(&format!("{language}.pack"));
    status(
        runner()
            .arg("pack")
            .arg(source.join("language.rcore"))
            .arg(source.join("language.xtext"))
            .arg(source.join("analysis.json"))
            .arg(&pack)
            .output()
            .unwrap(),
        0,
    );
    pack
}

fn check(pack: &Path, model: &Path, report: &Path, code: i32) -> Value {
    status(
        runner()
            .arg("check")
            .arg(pack)
            .arg(model)
            .arg("--report")
            .arg(report)
            .output()
            .unwrap(),
        code,
    );
    serde_json::from_slice(&fs::read(report).unwrap()).unwrap()
}

fn case<'a>(report: &'a Value, name: &str) -> &'a Value {
    report["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == name)
        .unwrap()
}

#[test]
fn load_two_packs_after_build_and_run_ci_cases() {
    let scratch = Scratch::new();
    let pack = package("cistern", &scratch);
    let model = fixture("cistern/garden.cistern");
    let report_file = scratch.file("report.json");
    let report = check(&pack, &model, &report_file, 0);
    assert_eq!(report["format"], "intersect.analysis.report.v1");
    assert_eq!(
        case(&report, "Garden::sizeInlet")["result"]["value"]["value"],
        1.25
    );
    assert_eq!(
        case(&report, "Garden::operatingFlow")["result"]["satisfied"],
        true
    );
    let samples = case(&report, "Garden::flowSweep")["result"]["samples"]
        .as_array()
        .unwrap();
    let times: Vec<_> = samples
        .iter()
        .map(|sample| sample["value"]["value"].as_f64().unwrap())
        .collect();
    assert_eq!(times, [5.0, 2.5, 1.25]);
    let simulation = &case(&report, "Garden::fillTrace")["result"]["simulation"];
    assert_eq!(simulation["crossing"]["value"], 2.5);
    assert_eq!(simulation["samples"][5]["volume"]["value"], 6.0);
    assert_eq!(check(&pack, &model, &report_file, 0), report);

    let allocation = package("allocation", &scratch);
    let report = check(
        &allocation,
        &fixture("allocation/materials.allocation"),
        &report_file,
        0,
    );
    assert_eq!(
        case(&report, "Materials::order")["result"]["satisfied"],
        true
    );
    assert_eq!(
        case(&report, "Materials::balance")["result"]["value"]["value"],
        24.0
    );
    assert_eq!(
        case(&report, "Materials::reservations")["result"]["samples"][2]["value"]["value"],
        15.0
    );

    let text = fs::read_to_string(model).unwrap();
    let changed = scratch.file("changed.cistern");
    fs::write(
        &changed,
        text.replace("inlet flows at 2 L/s", "inlet flows at 1 L/s"),
    )
    .unwrap();
    let report = check(&pack, &changed, &report_file, 1);
    let failed = case(&report, "Garden::fillTrace");
    assert_eq!(failed["status"], "fail");
    assert_eq!(failed["result"]["simulation"]["crossing"]["value"], 5.0);
    assert_eq!(
        case(&report, "Garden::sizeInlet")["result"]["value"]["value"],
        1.25
    );

    let wrong_units = text.replace("inlet flows at 2 L/s", "inlet flows at 2 L");
    fs::write(&changed, &wrong_units).unwrap();
    let report = check(&pack, &changed, &report_file, 1);
    let diagnostic = &case(&report, "Garden::fillTrace")["diagnostic"];
    assert_eq!(diagnostic["code"], "dimension");
    let source = &diagnostic["source"];
    let start = source["start"].as_u64().unwrap() as usize;
    let end = source["end"].as_u64().unwrap() as usize;
    assert!(wrong_units[start..end].trim().starts_with("2 L"));
}

#[test]
#[ignore = "requires INTERSECT_SYSML_ANALYSIS_PACK and the prepared standard library"]
fn native_sysml_and_embedded_cistern_use_the_same_solver() {
    let scratch = Scratch::new();
    let cistern = package("cistern", &scratch);
    let sysml_pack = std::env::var_os("INTERSECT_SYSML_ANALYSIS_PACK")
        .expect("set INTERSECT_SYSML_ANALYSIS_PACK");
    let model = fixture("sysml/garden.sysml");
    let report_file = scratch.file("sysml.json");
    let four_seconds = fixture("sysml/fill-in-four-seconds.json");
    let five_seconds = scratch.file("five-seconds.json");
    fs::write(&five_seconds, r#"{"fillTime":{"value":5,"unit":"s"}}"#).unwrap();
    for (name, inputs, expected) in [
        ("CisternAnalysis::sizeInlet", Some(&four_seconds), 1.25),
        ("CisternAnalysis::sizeSlow", Some(&five_seconds), 1.0),
        ("CisternAnalysis::sizeEmbedded", None, 1.25),
    ] {
        let mut command = runner();
        command
            .arg("sysml")
            .arg(&sysml_pack)
            .arg(&model)
            .args(["--case", name])
            .arg("--report")
            .arg(&report_file);
        if let Some(inputs) = inputs {
            command.arg("--inputs").arg(inputs);
        } else {
            command.arg("--body-pack").arg(&cistern);
        }
        status(command.output().unwrap(), 0);
        let report: Value = serde_json::from_slice(&fs::read(&report_file).unwrap()).unwrap();
        assert_eq!(case(&report, name)["result"]["value"]["value"], expected);
        assert_eq!(case(&report, name)["result"]["value"]["unit"], "L/s");
    }
    let original = fs::read_to_string(&model).unwrap();
    let invalid = scratch.file("invalid.sysml");
    for (name, embedded, changed, blamed) in [
        (
            "CisternAnalysis::sizeInlet",
            false,
            original.replacen("1 [L]", "1 [s]", 1),
            "1 [s]",
        ),
        (
            "CisternAnalysis::sizeEmbedded",
            true,
            original.replace("starts with 0 L", "starts with 0 s"),
            "0 s",
        ),
    ] {
        fs::write(&invalid, &changed).unwrap();
        let mut command = runner();
        command
            .arg("sysml")
            .arg(&sysml_pack)
            .arg(&invalid)
            .args(["--case", name])
            .arg("--report")
            .arg(&report_file);
        if embedded {
            command.arg("--body-pack").arg(&cistern);
        } else {
            command.arg("--inputs").arg(&four_seconds);
        }
        status(command.output().unwrap(), 1);
        let report: Value = serde_json::from_slice(&fs::read(&report_file).unwrap()).unwrap();
        let diagnostic = &case(&report, name)["diagnostic"];
        assert_eq!(diagnostic["code"], "dimension");
        let source = &diagnostic["source"];
        let start = source["start"].as_u64().unwrap() as usize;
        let end = source["end"].as_u64().unwrap() as usize;
        let uri = invalid
            .to_string_lossy()
            .replace('\\', "/")
            .replace('%', "%25")
            .replace('#', "%23")
            .replace('?', "%3F")
            .replace(' ', "%20");
        assert_eq!(source["uri"], uri);
        assert!(
            changed[start..end].trim().starts_with(blamed),
            "diagnostic was {diagnostic}"
        );
    }
}
