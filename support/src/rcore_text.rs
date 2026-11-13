//! Handwritten host for ordinary text over an authored Rcore definition.
use super::{Source, TERMINALS, TERMINALS_URI, Text};
use intersect_model::{
    core::model::Model,
    definitions::{
        bundle::{DefinitionBundle, SourceKind},
        grammar::Profile,
        schema::{BundleCompilation, Schema},
    },
};

/// Bind a text model to its authored runtime declarations and operations.
pub fn load_rcore_runtime(
    namespace: &str,
    structure: Text<'_>,
    grammar: Text<'_>,
    sources: &[Source],
    operations: &[(&str, &str, &str)],
) -> Result<
    (
        intersect_model::rcore::RcorePackage,
        intersect_model::api::BasicModel,
    ),
    String,
> {
    use intersect_model::{api::BasicModel, compile_rcore_at, core::frozen::FrozenStore};
    let (text_schema, mut parsed) = load_rcore_text(namespace, structure, grammar, sources)?;
    let mut package =
        compile_rcore_at(structure.uri, structure.content).map_err(|e| e.to_string())?;
    let runtime = package.schema();
    for element in &mut parsed.elements {
        let declaration = text_schema
            .declarations
            .get(&element.class)
            .ok_or_else(|| format!("Missing text declaration for {}", element.class))?;
        let key = runtime.class_key(
            &declaration.source,
            &declaration.namespace,
            &declaration.name,
        )?;
        if runtime.declarations.get(key) != Some(declaration) || !runtime.classes.contains_key(key)
        {
            return Err(format!("Runtime declaration differs for {}", element.class));
        }
        element.class = key.into();
        element.type_identity = runtime.identity(key);
    }
    parsed.schema_revision.clone_from(&runtime.revision);
    let store = FrozenStore::from_materialized(runtime, &parsed)?;
    let model = BasicModel::from_store(runtime.clone(), store)?;
    model.validate()?;
    for (class, operation, provider) in operations {
        package
            .bind_operation(class, operation, provider)
            .map_err(|e| e.to_string())?;
    }
    Ok((package, model))
}
use intersect_xtext::{
    EvaluationLimits,
    document::{AnalysisLimits, DocumentLanguage},
    ordinary,
};

pub fn load_rcore_text(
    namespace: &str,
    structure: Text<'_>,
    grammar: Text<'_>,
    sources: &[Source],
) -> Result<(Schema, Model), String> {
    let structure = structure.definition(SourceKind::Rcore);
    let mut terminals = Text {
        uri: TERMINALS_URI,
        content: TERMINALS,
    }
    .definition(SourceKind::Xtext);
    terminals.dependencies.push(structure.id.clone());
    let mut grammar = grammar.definition(SourceKind::Xtext);
    grammar
        .dependencies
        .extend([structure.id.clone(), terminals.id.clone()]);
    let input = BundleCompilation {
        ecore: structure.id.clone(),
        xtext: Some(grammar.id.clone()),
        rcore_behavior: structure.id.clone(),
        namespace: namespace.into(),
        materialized_types: vec![],
        bundle: DefinitionBundle {
            version: 1,
            sources: vec![structure, terminals, grammar],
            namespaces: vec![],
        },
    };
    let text_package =
        ordinary::compile(input, Profile::NativeV80).map_err(|e| format!("{e:?}"))?;
    let language = DocumentLanguage::prepare(
        &text_package,
        Default::default(),
        AnalysisLimits::workbench(),
    )
    .map_err(|e| format!("{e:?}"))?;
    let analysis = language.analyze_sources(sources, None, EvaluationLimits::native())?;
    let result = analysis
        .valid_model
        .ok_or_else(|| format!("{:?}", analysis.diagnostics))?;
    Ok((text_package.schema, result.model))
}
