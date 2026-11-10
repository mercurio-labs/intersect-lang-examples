//! Handwritten host for the shared frozen text path.
use intersect_model::{
    core::{
        frozen::{FrozenStore, Issue, Metamodel, Model, ObjectIssue, Severity},
        query::QueryBudget,
    },
    definitions::{
        bundle::{DefinitionBundle, DefinitionSource, SourceKind},
        ecore::ParseLimits,
        grammar::Profile,
        preparation::PreparedLanguageDefinition,
        rcore_behavior::ir_v2::Limits,
        rcore_scope::{
            BindingKind, VerifiedScope, compile_binding_kinds_with_source_limits,
            source_scope_bindings, source_validate_bindings,
        },
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

mod pack;
mod rcore_text;

pub use intersect_xtext::Source;
pub use pack::{MAX_EXAMPLE_PACK_BYTES, build_pack, load_pack};
pub use rcore_text::load_rcore_text;

const TERMINALS_URI: &str = "org/eclipse/xtext/common/Terminals.xtext";
const TERMINALS: &str = include_str!("../language/Terminals.xtext");
const PROFILE: Profile = Profile::NativeV80;
const SOURCE_POLICY: CompilationSourcePolicy = CompilationSourcePolicy {
    structure_bytes: 256_000,
    xtext_bytes: 256_000,
    xtext_declarations: 128,
};
const LIMITS: ParseLimits = ParseLimits {
    source_bytes: 1_000_000,
};

#[derive(Clone, Copy)]
pub struct Text<'a> {
    pub uri: &'a str,
    pub content: &'a str,
}

pub enum Structure<'a> {
    Ecore(Text<'a>),
    Rcore(Text<'a>),
}

impl Structure<'_> {
    fn definition(&self) -> DefinitionSource {
        match self {
            Self::Ecore(text) => text.definition(SourceKind::Ecore),
            Self::Rcore(text) => text.definition(SourceKind::Rcore),
        }
    }
}

pub struct Language<'a> {
    pub namespace: &'a str,
    pub structure: Structure<'a>,
    pub grammar: Text<'a>,
    pub bindings: Text<'a>,
}

impl Text<'_> {
    fn definition(self, kind: SourceKind) -> DefinitionSource {
        DefinitionSource::new(self.uri, kind, self.content)
    }
}

pub struct Loaded {
    pub model: Model,
    pub diagnostics: Vec<LocatedIssue>,
}

impl Loaded {
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|diagnostic| diagnostic.issue.severity == Severity::Error)
    }
}

#[derive(Debug)]
pub struct LocatedIssue {
    pub issue: Issue,
    pub location: Option<ObjectLocation>,
}

#[derive(Debug)]
pub struct ObjectLocation {
    pub resource: String,
    pub identity: String,
    pub span: Option<(usize, usize)>,
}

fn locate_issue(model: &Model, found: ObjectIssue) -> LocatedIssue {
    let location = model.obj(found.object).map(|object| {
        let (start, end) = object.span();
        ObjectLocation {
            resource: object.resource().to_owned(),
            identity: object.identity().to_owned(),
            span: (start < end).then_some((start, end)),
        }
    });
    LocatedIssue {
        issue: found.issue,
        location,
    }
}

/// Prepare a metamodel and Xtext, construct a frozen model, link it through the
/// declared Rcore scopes, validate its structure, and locate Rcore rule issues.
pub fn load(language: &Language<'_>, sources: &[Source]) -> Result<Loaded, String> {
    compile_language(language, |definition, bundle, scopes| {
        load_prepared(definition, bundle, scopes, sources)
    })
}

fn compile_language<T>(
    language: &Language<'_>,
    consume: impl FnOnce(
        &PreparedLanguageDefinition<'_>,
        &DefinitionBundle,
        &[VerifiedScope],
    ) -> Result<T, String>,
) -> Result<T, String> {
    let structure = language.structure.definition();
    let migrate = structure.kind == SourceKind::Ecore;
    let mut terminals = DefinitionSource::new(TERMINALS_URI, SourceKind::Xtext, TERMINALS);
    terminals.dependencies.push(structure.id.clone());
    let mut grammar = language.grammar.definition(SourceKind::Xtext);
    grammar
        .dependencies
        .extend([structure.id.clone(), terminals.id.clone()]);
    let mut rules = DefinitionSource::new(
        "load-rules.rcore",
        SourceKind::RcoreBehavior,
        r#"rcore 1; package example.load version "1";"#,
    );
    rules.dependencies.push(structure.id.clone());

    let input = BundleCompilation {
        bundle: DefinitionBundle {
            version: 1,
            sources: vec![structure.clone(), terminals, grammar.clone(), rules.clone()],
            namespaces: vec![],
        },
        ecore: structure.id.clone(),
        xtext: Some(grammar.id),
        rcore_behavior: rules.id,
        namespace: language.namespace.into(),
        materialized_types: vec![],
    };
    // Preparation retains an exact origin bundle. An empty target map
    // passes authored Rcore through with its original source identity.
    let targets = if migrate {
        [(structure.id, "structure.rcore".into())].into()
    } else {
        Default::default()
    };
    let migration =
        intersect_model::migration::migrate_ecore_bundle(input.bundle.clone(), &targets)
            .map_err(|error| format!("Prepare structure origin: {error}"))?;
    let input = migration.remap_compilation(&input)?;
    let definition = intersect_xtext::compiler::prepare_bundle_with_borrowed_authored_validation(
        &input,
        &migration,
        PROFILE,
        &[],
        None,
        SOURCE_POLICY,
        SOURCE_POLICY,
        &|_, _, _| Ok(()),
    )
    .map_err(|error| format!("Prepare language: {error:?}"))?;

    let (bundle, bindings) = binding_input(language, &definition)?;
    let mut declarations: Vec<_> = source_scope_bindings(&bindings, LIMITS)
        .map_err(|error| format!("Read bindings: {error:?}"))?
        .iter()
        .map(|binding| (binding.declaration, BindingKind::Scope))
        .collect();
    let validations = source_validate_bindings(&bindings, LIMITS)
        .map_err(|error| format!("Read validation bindings: {error:?}"))?;
    declarations.extend(
        validations
            .into_iter()
            .map(|binding| (binding.declaration, BindingKind::Validate)),
    );
    let scopes = compile_binding_kinds_with_source_limits(
        &bundle,
        &bindings.id,
        &declarations,
        &Limits::default(),
        LIMITS,
    )
    .map_err(|error| format!("Compile bindings: {error:?}"))?;
    consume(&definition, &bundle, &scopes)
}

fn binding_input(
    language: &Language<'_>,
    definition: &PreparedLanguageDefinition<'_>,
) -> Result<(DefinitionBundle, DefinitionSource), String> {
    let structure = definition
        .sources()
        .sources
        .iter()
        .find(|source| {
            source.id == definition.selection().ecore && source.kind == SourceKind::Rcore
        })
        .ok_or("Prepared language has no Rcore structure")?
        .clone();
    let mut bindings = language.bindings.definition(SourceKind::RcoreBehavior);
    bindings.dependencies.push(structure.id.clone());
    let bundle = DefinitionBundle {
        version: 1,
        sources: vec![structure, bindings.clone()],
        namespaces: vec![],
    };
    Ok((bundle, bindings))
}

fn load_prepared(
    definition: &PreparedLanguageDefinition<'_>,
    bundle: &DefinitionBundle,
    scopes: &[VerifiedScope],
    sources: &[Source],
) -> Result<Loaded, String> {
    let inner = GrammarPolicy::new(definition);
    let capability = OpenDraftCapability::new(definition, &inner)?;
    let draft = DraftLanguage::bind(definition, &capability, AnalysisLimits::workbench())?;
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

    let resolvers = RcoreScopes::new(&metamodel, bundle, scopes)
        .map_err(|error| format!("Bind language: {error}"))?;
    let model = store
        .into_builder()
        .map_err(|error| format!("Build model: {error}"))?
        .link(&resolvers)
        .map_err(|error| format!("Link model: {error:?}"))?
        .validate()
        .map_err(|error| format!("Validate model structure: {error:?}"))?;
    let diagnostics = model
        .check(&resolvers)
        .into_iter()
        .map(|found| locate_issue(&model, found))
        .collect();
    Ok(Loaded { model, diagnostics })
}
