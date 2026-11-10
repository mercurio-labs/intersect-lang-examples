//! Handwritten host for the shared frozen text path.
use intersect_model::{
    core::{
        frozen::{FrozenStore, Metamodel, Model},
        query::QueryBudget,
    },
    definitions::{
        bundle::{DefinitionBundle, DefinitionSource, SourceKind},
        ecore::ParseLimits,
        grammar::Profile,
        rcore_behavior::ir_v2::Limits,
        rcore_scope::{compile_bindings_with_source_limits, source_scope_bindings},
        schema::{BundleCompilation, CompilationSourcePolicy},
    },
    frozen_scopes::RcoreScopes,
};
use intersect_xtext::{
    EvaluationLimits,
    document::AnalysisLimits,
    draft::{DraftLanguage, GrammarPolicy, OpenDraftCapability},
};
use std::sync::Arc;

pub use intersect_xtext::Source;

const TERMINALS_URI: &str = "org/eclipse/xtext/common/Terminals.xtext";
const TERMINALS: &str = include_str!("../language/Terminals.xtext");
const LIMITS: ParseLimits = ParseLimits {
    source_bytes: 1_000_000,
};

#[derive(Clone, Copy)]
pub struct Text<'a> {
    pub uri: &'a str,
    pub content: &'a str,
}

pub struct Language<'a> {
    pub namespace: &'a str,
    pub ecore: Text<'a>,
    pub grammar: Text<'a>,
    pub bindings: Text<'a>,
}

impl Text<'_> {
    fn definition(self, kind: SourceKind) -> DefinitionSource {
        DefinitionSource::new(self.uri, kind, self.content)
    }
}

/// Prepare Ecore and Xtext, construct a frozen model, link it through the
/// declared Rcore scopes, and validate its structure.
pub fn load(language: &Language<'_>, sources: &[Source]) -> Result<Model, String> {
    let ecore = language.ecore.definition(SourceKind::Ecore);
    let mut terminals = DefinitionSource::new(TERMINALS_URI, SourceKind::Xtext, TERMINALS);
    terminals.dependencies.push(ecore.id.clone());
    let mut grammar = language.grammar.definition(SourceKind::Xtext);
    grammar
        .dependencies
        .extend([ecore.id.clone(), terminals.id.clone()]);
    let mut rules = DefinitionSource::new(
        "load-rules.rcore",
        SourceKind::RcoreBehavior,
        r#"rcore 1; package example.load version "1";"#,
    );
    rules.dependencies.push(ecore.id.clone());

    let input = BundleCompilation {
        bundle: DefinitionBundle {
            version: 1,
            sources: vec![ecore.clone(), terminals, grammar.clone(), rules.clone()],
            namespaces: vec![],
        },
        ecore: ecore.id.clone(),
        xtext: Some(grammar.id),
        rcore_behavior: rules.id,
        namespace: language.namespace.into(),
        materialized_types: vec![],
    };
    let migration = intersect_model::migration::migrate_ecore_bundle(
        input.bundle.clone(),
        &[(ecore.id, "structure.rcore".into())].into(),
    )
    .map_err(|error| format!("Migrate Ecore: {error}"))?;
    let input = migration.remap_compilation(&input)?;
    let policy = CompilationSourcePolicy::default();
    let definition = intersect_xtext::compiler::prepare_bundle_with_borrowed_authored_validation(
        &input,
        &migration,
        Profile::NativeV80,
        &[],
        None,
        policy,
        policy,
        &|_, _, _| Ok(()),
    )
    .map_err(|error| format!("Prepare language: {error:?}"))?;

    let inner = GrammarPolicy::new(&definition);
    let capability = OpenDraftCapability::new(&definition, &inner)?;
    let draft = DraftLanguage::bind(&definition, &capability, AnalysisLimits::workbench())?;
    let metamodel = Arc::new(
        Metamodel::freeze(definition.schema())
            .map_err(|error| format!("Freeze metamodel: {error}"))?,
    );
    let mut store = FrozenStore::new(metamodel.clone());
    for source in sources {
        let (evaluation, _, _) = draft.parse_runtime_into(
            source,
            EvaluationLimits::native(),
            &mut store,
            &mut QueryBudget::new(usize::MAX),
        )?;
        if !evaluation.diagnostics.is_empty() {
            return Err(format!("{}: {:?}", source.uri, evaluation.diagnostics));
        }
    }

    let structure = definition
        .sources()
        .sources
        .iter()
        .find(|source| source.kind == SourceKind::Rcore)
        .ok_or("Prepared language has no migrated structure")?
        .clone();
    let mut bindings = language.bindings.definition(SourceKind::RcoreBehavior);
    bindings.dependencies.push(structure.id.clone());
    let bundle = DefinitionBundle {
        version: 1,
        sources: vec![structure, bindings.clone()],
        namespaces: vec![],
    };
    let declarations: Vec<_> = source_scope_bindings(&bindings, LIMITS)
        .map_err(|error| format!("Read bindings: {error:?}"))?
        .iter()
        .map(|binding| (binding.declaration, false))
        .collect();
    let scopes = compile_bindings_with_source_limits(
        &bundle,
        &bindings.id,
        &declarations,
        &Limits::default(),
        LIMITS,
    )
    .map_err(|error| format!("Compile bindings: {error:?}"))?;
    let resolvers = RcoreScopes::new(&metamodel, &bundle, &scopes)
        .map_err(|error| format!("Bind language: {error}"))?;
    store
        .into_builder()
        .map_err(|error| format!("Build model: {error}"))?
        .link(&resolvers)
        .map_err(|error| format!("Link model: {error:?}"))?
        .validate()
        .map_err(|error| format!("Validate model structure: {error:?}"))
}
