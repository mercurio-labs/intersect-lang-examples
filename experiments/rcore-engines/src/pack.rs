//! Authored TOML and execution of the verified Text archive on Run hosts.
use crate::{CaseTrace, ModelBinding, RunInputs, check_builtin_engine, prepare_declared_profile};
use intersect_model::{
    core::{query::QueryBudget, resources::validate_resource_uri, storage::ModelRead},
    definitions::{
        bundle::{BUNDLE_VERSION, DefinitionBundle, DefinitionSource, SourceKind},
        ecore_migration::migrate_ecore_bundle,
        pack::canonical_digest,
    },
};
use intersect_text::{
    EvaluationLimits, Source,
    distribution::{self, ExecutionManifest, LanguageArchive, PackageMetadata},
    grammar::Profile as TextProfile,
    linking::LinkingContext,
    package::{BundleCompilation, Package},
    rcore_scopes::RcoreScopes,
};
use serde::{Deserialize, Deserializer, Serialize, de};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

pub const MAX_ARCHIVE_WIRE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 64;
const MAX_ARCHIVE_TEXT_BYTES: usize = 2_000_000;

#[derive(Serialize)]
#[serde(transparent)]
pub struct Archive(BTreeMap<String, String>);

impl<'de> Deserialize<'de> for Archive {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Files;

        impl<'de> de::Visitor<'de> for Files {
            type Value = Archive;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a map of archive paths to exact UTF-8 text")
            }

            fn visit_map<M: de::MapAccess<'de>>(self, mut input: M) -> Result<Archive, M::Error> {
                let mut files = BTreeMap::new();
                let mut bytes = 0;
                while let Some((path, text)) = input.next_entry::<String, String>()? {
                    bytes += text.len();
                    if files.len() == MAX_ARCHIVE_ENTRIES || bytes > MAX_ARCHIVE_TEXT_BYTES {
                        return Err(de::Error::custom(
                            "Expanded language archive exceeds its limits",
                        ));
                    }
                    if files.insert(path, text).is_some() {
                        return Err(de::Error::custom("Duplicate language archive path"));
                    }
                }
                Ok(Archive(files))
            }
        }

        deserializer.deserialize_map(Files)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthoringManifest {
    package: PackageMetadata,
    definitions: Definitions,
    execution: Option<ExecutionManifest>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Definitions {
    namespace: String,
    metamodel: String,
    grammar: Option<String>,
    behavior: Option<String>,
    #[serde(default)]
    profile: TextProfile,
    #[serde(default)]
    grammar_dependencies: Vec<String>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRequest {
    pub profile: Option<String>,
    pub model: Option<ModelInput>,
    #[serde(default)]
    pub inputs: RunInputs,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModelInput {
    pub root: Option<String>,
    pub sources: Vec<Source>,
}

#[derive(Serialize)]
pub struct Provenance {
    pub package: String,
    pub archive_revision: String,
    pub schema_revision: String,
    pub engine: String,
    pub profile: String,
    pub source: String,
    pub profile_source_sha256: String,
    pub model_sha256: Option<String>,
    pub inputs_sha256: String,
}

#[derive(Serialize)]
pub struct RunResponse {
    pub provenance: Provenance,
    pub cases: Vec<CaseTrace>,
}

#[derive(Serialize)]
pub struct CheckResponse {
    pub provenance: Provenance,
}

pub fn build(
    manifest: &str,
    mut read: impl FnMut(&str) -> Result<String, String>,
) -> Result<Archive, String> {
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err("Language manifest exceeds 64 KiB".into());
    }
    let authored: AuthoringManifest = toml::from_str(manifest).map_err(issue)?;
    let definitions = authored.definitions;
    let structure = read_definition(&mut read, &definitions.metamodel, SourceKind::Rcore)?;
    let structural_entry = structure.id.clone();
    let mut sources = vec![structure];
    if definitions.grammar.is_none() && !definitions.grammar_dependencies.is_empty() {
        return Err("Grammar dependencies require a selected grammar".into());
    }
    let mut grammar_dependencies = vec![structural_entry.clone()];
    for path in definitions.grammar_dependencies {
        let mut parent = read_definition(&mut read, &path, SourceKind::Xtext)?;
        parent.dependencies.push(structural_entry.clone());
        grammar_dependencies.push(parent.id.clone());
        sources.push(parent);
    }
    let xtext = if let Some(path) = definitions.grammar {
        let mut grammar = read_definition(&mut read, &path, SourceKind::Xtext)?;
        grammar.dependencies = grammar_dependencies;
        let id = grammar.id.clone();
        sources.push(grammar);
        Some(id)
    } else {
        None
    };
    let rcore_behavior = if let Some(path) = definitions.behavior {
        let mut behavior = read_definition(&mut read, &path, SourceKind::RcoreBehavior)?;
        behavior.dependencies.push(structural_entry.clone());
        let id = behavior.id.clone();
        sources.push(behavior);
        id
    } else {
        structural_entry.clone()
    };
    let compilation = BundleCompilation {
        materialized_types: vec![],
        bundle: DefinitionBundle {
            version: BUNDLE_VERSION,
            sources,
            namespaces: vec![],
        },
        ecore: structural_entry,
        namespace: definitions.namespace,
        xtext,
        rcore_behavior,
    };
    let distribution = distribution::build_bundle_with_profile(
        compilation,
        authored.package,
        definitions.profile,
    )?;
    let (mut files, manifest) = match authored.execution {
        Some(execution) => {
            for profile in execution.profiles.values() {
                check_builtin_engine(&profile.engine).map_err(issue)?;
            }
            let profile_sources = execution
                .source_paths()?
                .into_iter()
                .map(|path| {
                    let source = read(path)?;
                    if source.len() > crate::rcore::MAX_SOURCE_BYTES {
                        return Err(format!("Rcore execution source {path:?} exceeds 64 KiB"));
                    }
                    Ok((path.into(), source))
                })
                .collect::<Result<_, String>>()?;
            let archive = distribution.with_execution(execution, profile_sources)?;
            (
                archive.files,
                serde_json::to_string_pretty(&archive.manifest),
            )
        }
        None => (
            distribution.files,
            serde_json::to_string_pretty(&distribution.manifest),
        ),
    };

    files.insert("manifest.json".into(), manifest.map_err(issue)?);
    if files.len() > MAX_ARCHIVE_ENTRIES
        || files.values().map(String::len).sum::<usize>() > MAX_ARCHIVE_TEXT_BYTES
    {
        return Err("Expanded language archive exceeds its limits".into());
    }
    Ok(Archive(files))
}

fn read_definition(
    read: &mut impl FnMut(&str) -> Result<String, String>,
    path: &str,
    kind: SourceKind,
) -> Result<DefinitionSource, String> {
    if path.is_empty()
        || path.contains(['\\', ':'])
        || path.split('/').any(|part| matches!(part, "" | "." | ".."))
    {
        return Err(format!("Invalid definition path {path:?}"));
    }
    Ok(DefinitionSource::new(path, kind, read(path)?))
}

impl Archive {
    pub fn inspect(self) -> Result<serde_json::Value, String> {
        match distribution::import_archive(self.0)? {
            LanguageArchive::Source(archive) => serde_json::to_value(archive.manifest),
            LanguageArchive::Execution(archive) => serde_json::to_value(archive.manifest),
        }
        .map_err(issue)
    }

    pub fn check(self, request: RunRequest) -> Result<CheckResponse, String> {
        let (provenance, ()) = self.with_prepared(request, |_| Ok(()))?;
        Ok(CheckResponse { provenance })
    }

    pub fn run(self, request: RunRequest) -> Result<RunResponse, String> {
        let (provenance, mut cases) =
            self.with_prepared(request, |prepared| prepared.run().map_err(issue))?;
        for case in &mut cases {
            case.trace
                .header
                .metadata
                .model_digest
                .clone_from(&provenance.model_sha256);
        }
        Ok(RunResponse { provenance, cases })
    }

    fn with_prepared<T>(
        self,
        request: RunRequest,
        finish: impl FnOnce(crate::PreparedProfile<'_>) -> Result<T, String>,
    ) -> Result<(Provenance, T), String> {
        let LanguageArchive::Execution(archive) = distribution::import_archive(self.0)? else {
            return Err("Language pack has no execution profiles".into());
        };
        let manifest = &archive.manifest.language;
        let execution = &archive.manifest.execution;
        let name = request
            .profile
            .or_else(|| execution.default.clone())
            .ok_or("Choose an execution profile by name")?;
        let profile = execution
            .profiles
            .get(&name)
            .ok_or_else(|| format!("Unknown execution profile {name:?}"))?;
        check_builtin_engine(&profile.engine).map_err(issue)?;
        let source = archive
            .files
            .get(&profile.source)
            .ok_or("Missing verified execution source")?;
        let digest = manifest
            .files
            .get(&profile.source)
            .ok_or("Missing execution source digest")?;
        let mut provenance = Provenance {
            package: manifest.metadata.package_id.clone(),
            archive_revision: manifest.revision.clone(),
            schema_revision: manifest.schema_revision.clone(),
            engine: profile.engine.clone(),
            profile: name,
            source: profile.source.clone(),
            profile_source_sha256: digest.sha256.clone(),
            model_sha256: None,
            inputs_sha256: canonical_digest(&request.inputs).map_err(issue)?.sha256,
        };
        let uri = format!("pack:{}:{}", manifest.metadata.package_id, profile.source);
        let outcome = if let Some(model) = &request.model {
            let compilation = archive
                .package
                .compilation
                .as_ref()
                .ok_or("Execution requires a retained ordinary Rcore metamodel")?;
            let migration = migrate_ecore_bundle(compilation.bundle.clone(), &Default::default())
                .map_err(issue)?;
            let compilation =
                intersect_text::migration::remap_compilation(&migration, compilation)?;
            let text_profile =
                serde_json::from_value(serde_json::Value::String(manifest.runtime.profile.clone()))
                    .map_err(issue)?;
            let prepared =
                intersect_text::compiler::prepare_bundle_with_borrowed_authored_validation(
                    &compilation,
                    &migration,
                    text_profile,
                    &[],
                    None,
                    archive.package.source_policy.unwrap_or_default(),
                    Default::default(),
                    &|_, _, _| Ok(()),
                )
                .map_err(|diagnostics| format!("Model preparation failed: {diagnostics:?}"))?;
            if prepared.model().schema().revision != manifest.schema_revision {
                return Err("Prepared model schema differs from the archive schema".into());
            }
            let store = evaluate_model(&archive.package, model)?;
            let root = model_root(&store, model.root.as_deref())?;
            provenance.model_sha256 = Some(
                canonical_digest(&(root.as_str(), &model.sources))
                    .map_err(issue)?
                    .sha256,
            );
            let binding = ModelBinding {
                definition: prepared.model(),
                model: &store,
                root: &root,
            };
            finish(
                prepare_declared_profile(
                    &uri,
                    source,
                    &profile.engine,
                    Some(binding),
                    request.inputs,
                )
                .map_err(issue)?,
            )?
        } else {
            finish(
                prepare_declared_profile(&uri, source, &profile.engine, None, request.inputs)
                    .map_err(issue)?,
            )?
        };
        Ok((provenance, outcome))
    }
}

fn evaluate_model(
    package: &Package,
    model: &ModelInput,
) -> Result<intersect_model::core::frozen::FrozenStore, String> {
    let mut sources = BTreeSet::new();
    if model.sources.is_empty() {
        return Err("Model input needs at least one source".into());
    }
    for source in &model.sources {
        validate_resource_uri(&source.uri)?;
        if !sources.insert(source.uri.as_str()) {
            return Err(format!("Duplicate model resource {:?}", source.uri));
        }
    }
    let limits = EvaluationLimits::workbench();
    let result = if package.semantics.scope_bindings.is_empty() {
        intersect_text::evaluate_stored(package, &model.sources, limits)?
    } else {
        let scopes = RcoreScopes::from_package(package, &Default::default(), Default::default())?;
        intersect_text::evaluate_stored_with_linking_context(
            package,
            &model.sources,
            limits,
            None,
            None,
            &intersect_model::query::PackageDerived(package),
            &mut LinkingContext {
                resolver: &scopes,
                work: &mut QueryBudget::new(1_000_000),
            },
        )?
    };
    if !result.evaluation.diagnostics.is_empty() {
        return Err(format!(
            "Model analysis failed: {:?}",
            result.evaluation.diagnostics
        ));
    }
    Ok(result.store)
}

fn model_root(model: &dyn ModelRead, selected: Option<&str>) -> Result<String, String> {
    if let Some(root) = selected {
        return model
            .get(root)?
            .map(|_| root.into())
            .ok_or_else(|| format!("Unknown model root {root:?}"));
    }
    let resources = model.resource_records()?;
    let mut roots = resources
        .values()
        .flat_map(|resource| resource.roots.iter());
    match (roots.next(), roots.next()) {
        (Some(root), None) => Ok(root.clone()),
        _ => Err("Select a model root when the input has zero or multiple roots".into()),
    }
}

fn issue(error: impl ToString) -> String {
    error.to_string()
}
