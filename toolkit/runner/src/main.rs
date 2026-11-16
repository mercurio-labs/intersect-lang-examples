use intersect_toolkit_runner::read_pack;
use std::{collections::BTreeMap, fs, path::PathBuf};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("model.pack"));
    let input = read_pack(fs::read(path)?)?;
    let files: BTreeMap<String, String> = serde_json::from_value(input["language-files"].clone())?;
    // A downloaded cache is data, not trusted executable IR. Recompile and verify
    // the retained source archive through the published runtime before executing.
    let language = intersect_text::distribution::import_files(files)?;
    if serde_json::to_value(&language.package)? != input["package"] {
        return Err("Compiled package differs from its verified source archive".into());
    }
    let model = serde_json::from_value(input["model"].clone())?;
    let mut evaluation = intersect_text::Evaluation {
        model,
        diagnostics: vec![],
        references: vec![],
        derived: BTreeMap::new(),
    };
    evaluation.model.validate(&language.package.schema)?;
    intersect_text::apply_semantics(&language.package, &mut evaluation);
    if !evaluation.diagnostics.is_empty() {
        return Err(format!("Model validation failed: {:?}", evaluation.diagnostics).into());
    }
    let output = root.join("output");
    fs::create_dir_all(&output)?;
    fs::write(
        output.join("model.json"),
        serde_json::to_vec_pretty(&evaluation)?,
    )?;
    println!(
        "Loaded {} objects in {} resources; validation passed.",
        evaluation.model.elements.len(),
        evaluation.model.resources.len()
    );
    println!(
        "Evaluated derived values for {} objects.",
        evaluation.derived.len()
    );
    println!("Result: {}", output.join("model.json").display());
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
