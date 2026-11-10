//! Handwritten pack recipe for the ordinary frozen examples.
use super::{
    Language, Loaded, PROFILE, SOURCE_POLICY, Source, TERMINALS, TERMINALS_URI, binding_input,
    compile_language, load_prepared,
};
use intersect_model::definitions::{
    bundle::{DefinitionBundle, DefinitionSource, SourceKind},
    pack::{
        FileDigest, LanguagePack, PackBuilder, PackHeader, PackPart, PackRecipe,
        PackSectionEncoding, PackSectionFlags, PartKeyInput, canonical_json, part_key,
    },
    preparation::SavedOrdinaryDefinition,
    rcore_scope::{load_bindings, save_bindings},
};
use serde::{Deserialize, Serialize};

const SECTION: &str = "definition";
const KIND: &str = "intersect.examples.ordinary-definition.v1";
pub const MAX_EXAMPLE_PACK_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    definition: SavedOrdinaryDefinition,
    binding_bundle: DefinitionBundle,
    bindings: String,
}

fn header(language: &Language<'_>) -> PackHeader {
    let structure = language.structure.definition();
    let grammar = language.grammar.definition(SourceKind::Xtext);
    let bindings = language.bindings.definition(SourceKind::RcoreBehavior);
    let terminals = DefinitionSource::new(TERMINALS_URI, SourceKind::Xtext, TERMINALS);
    PackHeader {
        language: language.namespace.into(),
        recipe: PackRecipe {
            name: "intersect.examples.ordinary".into(),
            version: "1".into(),
        },
        compiler: [
            (
                "intersect-model".into(),
                intersect_model::SOURCE_IDENTITY.into(),
            ),
            (
                "intersect-xtext".into(),
                intersect_xtext::SOURCE_IDENTITY.into(),
            ),
        ]
        .into(),
        recipe_constants: Default::default(),
        inputs: [
            ("structure".into(), structure.id),
            ("grammar".into(), grammar.id),
            ("bindings".into(), bindings.id),
            ("terminals".into(), terminals.id),
        ]
        .into(),
        parts: vec![],
        requires_hooks: vec![],
        depends_on: vec![],
    }
}

fn part(header: &PackHeader, output_digest: String) -> Result<PackPart, String> {
    let input_digest = part_key(PartKeyInput {
        part: SECTION,
        part_version: 1,
        recipe: &header.recipe,
        components: &header.compiler,
        recipe_constants: &header.recipe_constants,
        inputs: &header.inputs,
        dependencies: &Default::default(),
    })
    .map_err(|error| error.to_string())?;
    Ok(PackPart {
        name: SECTION.into(),
        components: header.compiler.keys().cloned().collect(),
        inputs: header.inputs.keys().cloned().collect(),
        depends: vec![],
        input_digest,
        output_digest,
    })
}

pub fn build_pack(language: &Language<'_>) -> Result<Vec<u8>, String> {
    compile_language(language, |definition, bundle, scopes| {
        let payload = Payload {
            definition: definition.save_ordinary_host_cache()?,
            binding_bundle: bundle.clone(),
            bindings: save_bindings(scopes, intersect_model::SOURCE_IDENTITY)?,
        };
        let payload = canonical_json(&payload).map_err(|error| error.to_string())?;
        let mut header = header(language);
        let part = part(&header, FileDigest::of(&payload).sha256)?;
        let input_digest = part.input_digest.clone();
        let output_digest = part.output_digest.clone();
        header.parts.push(part);
        let bytes = PackBuilder::new(header)
            .section(
                SECTION,
                KIND,
                PackSectionFlags::REQUIRED,
                payload,
                input_digest,
                output_digest,
            )
            .build()
            .map_err(|error| error.to_string())?;
        check_size(bytes.len())?;
        Ok(bytes)
    })
}

/// Restore compiled data and bindings from the host's own pack. A missing,
/// incompatible or corrupt pack is an error. There is no source fallback.
pub fn load_pack(
    language: &Language<'_>,
    bytes: Vec<u8>,
    sources: &[Source],
) -> Result<Loaded, String> {
    check_size(bytes.len())?;
    let pack = LanguagePack::read(bytes).map_err(|error| error.to_string())?;
    let manifest = pack.manifest();
    let expected = header(language);
    if manifest.language != expected.language
        || manifest.recipe != expected.recipe
        || manifest.compiler != expected.compiler
        || manifest.inputs != expected.inputs
        || manifest.recipe_constants != expected.recipe_constants
        || manifest.requires_hooks != expected.requires_hooks
        || manifest.depends_on != expected.depends_on
    {
        return Err(
            "Pack language, recipe, compiler or definition sources differ from the host".into(),
        );
    }
    let [section] = manifest.sections.as_slice() else {
        return Err("Expected one compiled definition section".into());
    };
    if section.name != SECTION
        || section.kind != KIND
        || section.encoding != PackSectionEncoding::Json
        || section.flags != PackSectionFlags::REQUIRED
        || manifest.parts.as_slice() != [part(&expected, section.digest.sha256.clone())?]
    {
        return Err("Unexpected compiled definition section or part".into());
    }

    let mut payload: Payload = pack
        .section_json(SECTION)
        .map_err(|error| error.to_string())?;
    let definition = payload
        .definition
        .prepare_host_cache(PROFILE, SOURCE_POLICY)
        .map_err(|error| format!("Restore compiled definition: {error:?}"))?;
    let originals = &definition.original_sources().sources;
    if definition.selection().namespace != expected.language
        || ["structure", "grammar", "terminals"].iter().any(|role| {
            expected
                .inputs
                .get(*role)
                .is_none_or(|id| !originals.iter().any(|source| &source.id == id))
        })
    {
        return Err("Compiled definition does not match the pack's source identities".into());
    }
    let (bundle, _) = binding_input(language, &definition)?;
    if payload.binding_bundle != bundle {
        return Err("Pack Rcore bindings belong to another definition bundle".into());
    }
    let scopes = load_bindings(&payload.bindings, &bundle, intersect_model::SOURCE_IDENTITY)?;
    load_prepared(&definition, &bundle, &scopes, sources)
}

fn check_size(bytes: usize) -> Result<(), String> {
    if bytes > MAX_EXAMPLE_PACK_BYTES {
        return Err(format!(
            "Examples pack exceeds {MAX_EXAMPLE_PACK_BYTES} bytes"
        ));
    }
    Ok(())
}
