//! Native file operations. Parsing, validation and execution stay in Model/Text.
use crate::{build_pack, editable_files, read_pack};
use intersect_model::definitions::{bundle::SourceId, pack::LanguagePack};
use intersect_text::{
    Evaluation, Source,
    distribution::{self, Distribution, LanguageManifest},
    package::Package,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path},
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// The verified language and complete model, ready for your application code.
pub struct LoadedModel {
    pub language: Package,
    pub evaluation: Evaluation,
}

impl LoadedModel {
    pub fn summary(&self) -> String {
        format!(
            "Language: {}\n{} objects in {} resources; validation passed.\nDerived values evaluated for {} objects.",
            self.language.schema.name,
            self.evaluation.model.elements.len(),
            self.evaluation.model.resources.len(),
            self.evaluation.derived.len()
        )
    }
    pub fn write_result(&self, path: impl AsRef<Path>) -> Result<()> {
        write_file(path.as_ref(), &serde_json::to_vec_pretty(&self.evaluation)?)
    }
}

/// Load the saved snapshot. Editable files beside the pack are not consulted.
pub fn load_pack(path: impl AsRef<Path>) -> Result<LoadedModel> {
    let input = read_pack(fs::read(path)?)?;
    let files = serde_json::from_value(input["language-files"].clone())?;
    // Rebuild and compare the language before using downloaded compiled data.
    let language = distribution::import_files(files)?.package;
    if serde_json::to_value(&language)? != input["package"] {
        return Err("Compiled language differs from its retained source archive".into());
    }
    let mut evaluation = Evaluation {
        model: serde_json::from_value(input["model"].clone())?,
        diagnostics: vec![],
        references: vec![],
        derived: BTreeMap::new(),
    };
    evaluation.model.validate(&language.schema)?;
    intersect_text::apply_semantics(&language, &mut evaluation);
    checked(&evaluation)?;
    Ok(LoadedModel {
        language,
        evaluation,
    })
}

/// Inspect any native Intersect container, including recipes this runner cannot execute.
pub fn inspect_pack(path: impl AsRef<Path>) -> Result<String> {
    let pack = LanguagePack::read(fs::read(path)?)?;
    let manifest = pack.manifest();
    let mut text = format!(
        "Language: {}\nRecipe: {} v{}\nPack format: {}\nSections:\n",
        manifest.language, manifest.recipe.name, manifest.recipe.version, manifest.format
    );
    for section in &manifest.sections {
        text.push_str(&format!(
            "  {} ({} bytes)\n",
            section.name, section.digest.bytes
        ));
    }
    Ok(text)
}

/// Extract editable definitions/models from an existing Toolkit pack into an empty folder.
pub fn unpack_pack(path: impl AsRef<Path>, directory: impl AsRef<Path>) -> Result<()> {
    let bytes = fs::read(path.as_ref())?;
    let files = editable_files(&read_pack(bytes.clone())?)?;
    let root = directory.as_ref();
    if root.exists() && fs::read_dir(root)?.next().is_some() {
        return Err("Choose an empty output folder for unpack".into());
    }
    for name in files.keys() {
        relative(name)?;
    }
    fs::create_dir_all(root)?;
    for (name, text) in files {
        write_file(&root.join(name), text.as_bytes())?;
    }
    write_file(&root.join("model.pack"), &bytes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceFile {
    uri: String,
    file: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Project {
    version: u32,
    language_directory: String,
    definitions: Vec<SourceFile>,
    models: Vec<SourceFile>,
    entry_rule: Option<String>,
}

/// Recompile edited definitions and model files, then replace the output pack only on success.
pub fn build_project(project: impl AsRef<Path>, output: impl AsRef<Path>) -> Result<LoadedModel> {
    let project_path = project.as_ref().canonicalize()?;
    let root = project_path
        .parent()
        .ok_or("Project has no parent folder")?;
    let project: Project = serde_json::from_slice(&fs::read(&project_path)?)?;
    if project.version != 1 {
        return Err("Unsupported project.json version".into());
    }
    let baseline = read_language(root, &project.language_directory)?;
    let mut inputs = if let Some(compilation) = &baseline.package.compilation {
        serde_json::to_value(compilation)?
    } else {
        serde_json::to_value(
            baseline
                .package
                .xtext_inference
                .as_ref()
                .ok_or("Missing retained compilation inputs")?,
        )?
    };
    update_definitions(root, &project.definitions, &mut inputs)?;
    let policy = baseline.package.source_policy.unwrap_or_default();
    let distribution = if baseline.package.compilation.is_some() {
        let profile = baseline
            .package
            .grammar
            .as_ref()
            .ok_or("Missing grammar profile")?
            .profile;
        distribution::build_bundle_with_source_policy(
            serde_json::from_value(inputs)?,
            baseline.manifest.metadata,
            profile,
            policy,
            Default::default(),
        )?
    } else {
        distribution::build_inferred_with_context(
            serde_json::from_value(inputs)?,
            baseline.manifest.metadata,
            &[],
            None,
            policy,
            Default::default(),
        )?
    };
    let mut uris = BTreeSet::new();
    let mut sources = vec![];
    for source in project.models {
        if !uris.insert(source.uri.clone()) {
            return Err(format!("Duplicate model URI: {}", source.uri).into());
        }
        sources.push(Source {
            uri: source.uri,
            text: read_source(root, &source.file)?,
        });
    }
    let language = distribution.package;
    let evaluation = if let Some(entry) = &project.entry_rule {
        intersect_text::entry::EntryLanguage::prepare(&language, Default::default())
            .map_err(|e| format!("Invalid parser entry: {e:?}"))?
            .evaluate(entry, &sources, intersect_text::EvaluationLimits::native())?
            .evaluation
    } else {
        intersect_text::evaluate(&language, &sources)
    };
    checked(&evaluation)?;
    let mut files = distribution.files;
    files.insert(
        "manifest.json".into(),
        serde_json::to_string(&distribution.manifest)?,
    );
    let bytes = build_pack(
        &json!({"package":language,"model":evaluation.model,"sources":sources,"language-files":files,"entry-rule":project.entry_rule}),
    )?;
    write_pack(output.as_ref(), &bytes)?;
    Ok(LoadedModel {
        language,
        evaluation,
    })
}

fn read_language(root: &Path, directory: &str) -> Result<Distribution> {
    relative(directory)?;
    let directory = root.join(directory).canonicalize()?;
    if !directory.starts_with(root) {
        return Err("Language folder must be inside the project".into());
    }
    let manifest_text = read_source(&directory, "manifest.json")?;
    let manifest: LanguageManifest = serde_json::from_str(&manifest_text)?;
    let mut files = BTreeMap::new();
    for path in manifest.files.keys() {
        files.insert(path.clone(), read_source(&directory, path)?);
    }
    files.insert("manifest.json".into(), manifest_text);
    Ok(distribution::import_files(files)?)
}

fn update_definitions(root: &Path, files: &[SourceFile], input: &mut Value) -> Result<()> {
    let sources = input["bundle"]["sources"]
        .as_array_mut()
        .ok_or("Missing definition bundle")?;
    let mut replacements = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for file in files {
        if !seen.insert(&file.uri) {
            return Err(format!("Duplicate definition URI: {}", file.uri).into());
        }
        let source = sources
            .iter_mut()
            .find(|s| s["id"]["uri"].as_str() == Some(&file.uri))
            .ok_or_else(|| format!("Unknown definition URI: {}", file.uri))?;
        let text = read_source(root, &file.file)?;
        let old: SourceId = serde_json::from_value(source["id"].clone())?;
        replacements.insert(old, SourceId::for_text(&file.uri, &text));
        source["text"] = Value::String(text);
    }
    if files.len() != sources.len() {
        return Err("project.json must list every retained definition source".into());
    }
    // Refresh source identities and their dependency/namespace/entry references together.
    fn refresh(value: &mut Value, ids: &BTreeMap<SourceId, SourceId>) -> Result<()> {
        match value {
            Value::Object(object)
                if object.contains_key("uri") && object.contains_key("sha256") =>
            {
                let old: SourceId = serde_json::from_value(value.clone())?;
                if let Some(new) = ids.get(&old) {
                    *value = serde_json::to_value(new)?;
                }
            }
            Value::Object(object) => {
                for value in object.values_mut() {
                    refresh(value, ids)?;
                }
            }
            Value::Array(values) => {
                for value in values {
                    refresh(value, ids)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    refresh(input, &replacements)
}

fn checked(evaluation: &Evaluation) -> Result<()> {
    if evaluation.diagnostics.is_empty() {
        Ok(())
    } else {
        Err(format!("Model validation failed: {:?}", evaluation.diagnostics).into())
    }
}
fn relative(name: &str) -> Result<()> {
    if name.is_empty()
        || name.contains(['\\', ':'])
        || !Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(format!("Expected a project-relative path: {name}").into());
    }
    Ok(())
}
fn read_source(root: &Path, name: &str) -> Result<String> {
    relative(name)?;
    let path = root.join(name).canonicalize()?;
    if !path.starts_with(root) {
        return Err(format!("Source is outside the project: {name}").into());
    }
    Ok(fs::read_to_string(path)?)
}
fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(())
}

fn write_pack(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let name = path
        .file_name()
        .ok_or("Output pack needs a filename")?
        .to_string_lossy();
    let temporary = path.with_file_name(format!(".{name}.tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    Ok(result?)
}
