use crate::mapping::Mapping;
use intersect_model::definitions::{
    bundle::SourceId,
    pack::{
        FileDigest, LanguagePack, PackBuilder, PackHeader, PackRecipe, PackSectionFlags,
        canonical_json,
    },
};
use intersect_text::{compiler, package::Package};
use serde::{Deserialize, Serialize};
use std::{fs::File, io::Read, path::Path};

const RECIPE: &str = "intersect.run.language";
const SECTION: &str = "run/language";
const VERSION: &str = "1";
const MAX_SOURCE: u64 = 256 * 1024;
const MAX_PACK: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Definition {
    structure: String,
    grammar: String,
    mapping: String,
}

pub struct LoadedPack {
    pub language: Package,
    pub mapping: Mapping,
    pub digest: String,
}

impl Definition {
    fn prepare(&self) -> Result<(Package, Mapping), String> {
        let language = compiler::compile_rcore_with_profile(
            &self.structure,
            Some(&self.grammar),
            None,
            intersect_text::grammar::Profile::NativeV62,
        )
        .map_err(|diagnostics| format!("language definitions: {diagnostics:?}"))?;
        let mapping: Mapping = serde_json::from_str(&self.mapping)
            .map_err(|error| format!("execution mapping: {error}"))?;
        mapping.validate(&language.schema)?;
        Ok((language, mapping))
    }

    fn header(&self, language: &Package) -> PackHeader {
        PackHeader {
            language: language.schema.uri.clone(),
            recipe: PackRecipe {
                name: RECIPE.into(),
                version: VERSION.into(),
            },
            compiler: [
                (
                    "intersect-model".into(),
                    intersect_model::SOURCE_IDENTITY.into(),
                ),
                (
                    "intersect-text".into(),
                    intersect_text::compiler_identity().into(),
                ),
            ]
            .into(),
            recipe_constants: Default::default(),
            inputs: [
                (
                    "structure".into(),
                    SourceId::for_text("language.rcore", &self.structure),
                ),
                (
                    "grammar".into(),
                    SourceId::for_text("language.xtext", &self.grammar),
                ),
                (
                    "mapping".into(),
                    SourceId::for_text("analysis.json", &self.mapping),
                ),
            ]
            .into(),
            parts: vec![],
            requires_hooks: vec![],
            depends_on: vec![],
        }
    }
}

pub fn build(structure: &Path, grammar: &Path, mapping: &Path) -> Result<Vec<u8>, String> {
    let definition = Definition {
        structure: read_source(structure)?,
        grammar: read_source(grammar)?,
        mapping: read_source(mapping)?,
    };
    let (language, _) = definition.prepare()?;
    let payload = canonical_json(&definition).map_err(|error| error.to_string())?;
    let digest = FileDigest::of(&payload).sha256;
    PackBuilder::new(definition.header(&language))
        .section(
            SECTION,
            RECIPE,
            PackSectionFlags::REQUIRED,
            payload,
            &digest,
            &digest,
        )
        .build()
        .map_err(|error| error.to_string())
}

pub fn load(path: &Path) -> Result<LoadedPack, String> {
    let bytes = read(path, MAX_PACK)?;
    let digest = FileDigest::of(&bytes).sha256;
    let pack = LanguagePack::read(bytes).map_err(|error| error.to_string())?;
    let manifest = pack.manifest();
    let [section] = manifest.sections.as_slice() else {
        return Err("expected one analysis language pack section".into());
    };
    if manifest.recipe.name != RECIPE
        || manifest.recipe.version != VERSION
        || section.name != SECTION
        || section.kind != RECIPE
        || !manifest.requires_hooks.is_empty()
        || !manifest.depends_on.is_empty()
        || !manifest.parts.is_empty()
    {
        return Err("unsupported analysis language pack recipe".into());
    }
    let definition: Definition = pack
        .section_json(SECTION)
        .map_err(|error| error.to_string())?;
    let (language, mapping) = definition.prepare()?;
    let expected = definition.header(&language);
    if manifest.language != expected.language
        || manifest.compiler != expected.compiler
        || manifest.inputs != expected.inputs
        || manifest.recipe_constants != expected.recipe_constants
    {
        return Err("analysis pack identity does not match its definitions or runtime".into());
    }
    Ok(LoadedPack {
        language,
        mapping,
        digest,
    })
}

pub fn read_source(path: &Path) -> Result<String, String> {
    String::from_utf8(read(path, MAX_SOURCE)?)
        .map_err(|error| format!("{}: {error}", path.display()))
}

pub fn read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(limit + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("{}: {error}", path.display()))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{}: exceeds {limit} bytes", path.display()));
    }
    Ok(bytes)
}
