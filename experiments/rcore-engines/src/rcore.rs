use crate::error;
use intersect_model::{
    core::{query::QueryBudget, storage::ModelRead},
    definitions::{
        bundle::{BUNDLE_VERSION, DefinitionBundle, DefinitionSource, SourceId, SourceKind},
        preparation::PreparedModelDefinition,
        rcore_behavior::{
            self,
            ast::Declaration,
            function_lowering::compile_function,
            ir::{Value, ValueType},
            ir_v2::{
                DataWire, Effect, EntrySelection, Limits, TypeNode, ValueWire, VerifiedExecutable,
            },
            modules::SymbolId,
            types::Scalar,
        },
    },
    rcore_behavior_functions::{ExecutionContext, ExecutionLimits, evaluate},
    source_model_functions::SourceModelFunction,
};
use intersect_run::RunError;
use serde_json::{Value as Json, json};

pub(crate) const MAX_SOURCE_BYTES: usize = 65_536;

pub struct ModelBinding<'a> {
    pub definition: &'a PreparedModelDefinition<'a>,
    pub model: &'a dyn ModelRead,
    pub root: &'a str,
}

pub struct Program<'a> {
    binding: Option<ModelBinding<'a>>,
    source: SourceId,
    bundle: DefinitionBundle,
    document: rcore_behavior::ast::Document,
}

pub struct Function {
    executable: VerifiedExecutable,
}

impl<'a> Program<'a> {
    pub fn new(uri: &str, text: &str, binding: Option<ModelBinding<'a>>) -> Result<Self, RunError> {
        if text.len() > MAX_SOURCE_BYTES {
            return Err(error("Rcore profile exceeds 64 KiB"));
        }
        let mut source = DefinitionSource::new(uri, SourceKind::RcoreBehavior, text);
        let mut bundle = match &binding {
            Some(binding) => {
                source
                    .dependencies
                    .push(binding.definition.structure_selection().entry.clone());
                binding.definition.sources().clone()
            }
            None => DefinitionBundle {
                version: BUNDLE_VERSION,
                sources: vec![],
                namespaces: vec![],
            },
        };
        if bundle
            .sources
            .iter()
            .any(|existing| existing.id.uri == source.id.uri)
        {
            return Err(error(
                "Rcore profile URI is already a model definition source",
            ));
        }
        let document = rcore_behavior::parse(source.clone());
        if !document.diagnostics.is_empty() {
            return Err(error(format!("{:?}", document.diagnostics)));
        }
        let source_id = source.id.clone();
        bundle.sources.push(source);
        Ok(Self {
            binding,
            source: source_id,
            bundle,
            document,
        })
    }

    pub fn digest(&self) -> &str {
        &self.source.sha256
    }

    fn select(&self, name: &str) -> Result<(EntrySelection, usize), RunError> {
        let (declaration, arity) = self
            .document
            .declarations
            .iter()
            .enumerate()
            .find_map(|(index, item)| match &item.value {
                Declaration::Function {
                    name: symbol,
                    parameters,
                    ..
                } if symbol.value == name => Some((index, parameters.len())),
                _ => None,
            })
            .ok_or_else(|| error(format!("Rcore function {name} is missing")))?;
        let selector = EntrySelection {
            symbol: SymbolId {
                source: self.source.clone(),
                declaration,
            },
            types: vec![],
            arguments: vec![],
        };
        Ok((selector, arity))
    }

    pub fn prepare(&self, name: &str) -> Result<Function, RunError> {
        let (selector, _) = self.select(name)?;
        let executable =
            compile_function(&self.bundle, &self.source, &selector, &Limits::default())
                .map_err(|diagnostics| error(format!("Rcore {name}: {diagnostics:?}")))?;
        Ok(Function { executable })
    }

    pub fn call(&self, function: &Function, arguments: &[Value]) -> Result<Json, RunError> {
        let program = function.executable.program();
        let entry = &program.functions[program.entry.0 as usize];
        if arguments.len() != entry.parameters.len() {
            return Err(error("Rcore function argument count mismatch"));
        }
        let arguments = entry
            .parameters
            .iter()
            .zip(arguments)
            .map(|(ty, value)| ValueWire {
                ty: *ty,
                data: DataWire::Scalar(value.clone()),
            })
            .collect::<Vec<_>>();
        let result = evaluate(
            &function.executable,
            &arguments,
            &ExecutionContext::new(&self.bundle),
            &ExecutionLimits::default(),
        )
        .map_err(error)?;
        decode(result.value)
    }

    pub fn member<T: serde::de::DeserializeOwned>(&self, name: &str) -> Result<T, RunError> {
        let (selector, arity) = self.select(name)?;
        let value = match (&self.binding, arity) {
            (Some(binding), 1) => {
                let source = self
                    .bundle
                    .sources
                    .last()
                    .ok_or_else(|| error("Missing profile source"))?;
                let function = SourceModelFunction::from_prepared(
                    binding.definition,
                    vec![source.clone()],
                    &selector,
                    &Limits::default(),
                    ExecutionLimits::default(),
                    Default::default(),
                )
                .map_err(error)?;
                decode(
                    function
                        .invoke_model(
                            binding.model,
                            binding.root,
                            vec![],
                            &mut QueryBudget::new(1_000_000),
                        )
                        .map_err(error)?,
                )?
            }
            (_, 0) => {
                let function = self.prepare(name)?;
                self.call(&function, &[])?
            }
            _ => {
                return Err(error(format!(
                    "Rcore {name} needs zero arguments or one bound model receiver"
                )));
            }
        };
        serde_json::from_value(value).map_err(|issue| error(format!("Rcore {name}: {issue}")))
    }
}

impl Function {
    pub fn check_scalars(&self, parameters: &[Scalar], result: Scalar) -> Result<(), RunError> {
        let program = self.executable.program();
        let entry = &program.functions[program.entry.0 as usize];
        if self
            .executable
            .function_effect(program.entry)
            .map_err(error)?
            != Effect::Pure
        {
            return Err(error("Engine callbacks must be pure"));
        }
        if entry.parameters.len() != parameters.len()
            || !entry
                .parameters
                .iter()
                .zip(parameters)
                .all(|(id, scalar)| program.types[id.0 as usize] == TypeNode::Scalar(*scalar))
            || program.types[entry.result.0 as usize] != TypeNode::Scalar(result)
        {
            return Err(error(format!(
                "Engine callback must have signature {parameters:?} -> {result:?}"
            )));
        }
        Ok(())
    }
}

pub fn float(value: f64) -> Value {
    Value {
        ty: ValueType::Scalar(Scalar::Float64),
        payload: json!({"kind": "float64", "bits": format!("{:016x}", value.to_bits())}),
    }
}

pub fn boolean(value: bool) -> Value {
    Value {
        ty: ValueType::Scalar(Scalar::Bool),
        payload: json!(value),
    }
}

pub fn string(value: &str) -> Value {
    Value {
        ty: ValueType::Scalar(Scalar::String),
        payload: json!(value),
    }
}

fn decode(value: ValueWire) -> Result<Json, RunError> {
    match value.data {
        DataWire::Scalar(Value {
            ty: ValueType::Scalar(Scalar::Float64),
            payload,
        }) => {
            let value = payload["bits"]
                .as_str()
                .and_then(|bits| u64::from_str_radix(bits, 16).ok())
                .map(f64::from_bits)
                .filter(|number| number.is_finite())
                .ok_or_else(|| error("Invalid Rcore Float64 result"))?;
            Ok(json!(value))
        }
        DataWire::Scalar(Value {
            ty: ValueType::Scalar(Scalar::Int32 | Scalar::Int64),
            payload,
        }) => {
            let number = payload
                .as_i64()
                .or_else(|| payload["value"].as_i64())
                .or_else(|| payload["value"].as_str()?.parse().ok())
                .ok_or_else(|| error(format!("Invalid Rcore Int result {payload}")))?;
            Ok(json!(number))
        }
        DataWire::Scalar(value) => Ok(value.payload),
        DataWire::Collection(values) | DataWire::Tuple(values) => values
            .into_iter()
            .map(decode)
            .collect::<Result<Vec<_>, _>>()
            .map(Json::Array),
        DataWire::Record(fields) => fields
            .into_iter()
            .map(|(name, value)| Ok((name, decode(value)?)))
            .collect::<Result<serde_json::Map<_, _>, _>>()
            .map(Json::Object),
        DataWire::None => Ok(Json::Null),
        DataWire::Some(value) => decode(*value),
        _ => Err(error("Rcore value cannot bind to this profile")),
    }
}
