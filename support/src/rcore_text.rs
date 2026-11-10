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
