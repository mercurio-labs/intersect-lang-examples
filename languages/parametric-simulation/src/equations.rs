//! Host adapter for checked Float64 operations in the authored thermal language.
use intersect_model::{
    definitions::{
        bundle::{BUNDLE_VERSION, DefinitionBundle, DefinitionSource, SourceKind},
        rcore_behavior::{
            self,
            ast::Declaration,
            function_lowering::compile_function,
            ir,
            ir_v2::{DataWire, EntrySelection, Limits, ValueWire, VerifiedExecutable},
            modules::SymbolId,
            types::Scalar,
        },
    },
    rcore_behavior_functions::{ExecutionContext, ExecutionLimits, evaluate},
};
use serde_json::json;
use std::cell::OnceCell;

pub const SOURCE: &str = include_str!("../language/thermal.rcore");
pub const URI: &str = "language/thermal.rcore";

pub struct Equations {
    bundle: DefinitionBundle,
    heat_balance: VerifiedExecutable,
    temperature_rate: VerifiedExecutable,
    decay_exponent: VerifiedExecutable,
    analytic_temperature: VerifiedExecutable,
}

thread_local! {
    static THERMAL_EQUATIONS: OnceCell<Result<Equations, String>> = const { OnceCell::new() };
}

impl Equations {
    pub fn with<T>(
        accept: impl FnOnce(&Equations) -> Result<T, intersect_run::RunError>,
    ) -> Result<T, intersect_run::RunError> {
        THERMAL_EQUATIONS.with(|slot| {
            let equations = slot
                .get_or_init(Self::compile)
                .as_ref()
                .map_err(|error| intersect_run::RunError::Semantics(error.clone()))?;
            accept(equations)
        })
    }

    fn compile() -> Result<Self, String> {
        let source = DefinitionSource::new(URI, SourceKind::RcoreBehavior, SOURCE);
        let document = rcore_behavior::parse(source.clone());
        if !document.diagnostics.is_empty() {
            return Err(format!("Invalid thermal Rcore: {:?}", document.diagnostics));
        }
        let entry = source.id.clone();
        let bundle = DefinitionBundle {
            version: BUNDLE_VERSION,
            sources: vec![source],
            namespaces: vec![],
        };
        let compile = |name: &str| {
            let declaration = document.declarations.iter().position(|item|
                matches!(&item.value, Declaration::Function { name: function, .. } if function.value == name))
                .ok_or_else(|| format!("Missing thermal Rcore function {name}"))?;
            let selection = EntrySelection {
                symbol: SymbolId {
                    source: entry.clone(),
                    declaration,
                },
                types: vec![],
                arguments: vec![],
            };
            compile_function(&bundle, &entry, &selection, &Limits::default())
                .map_err(|errors| format!("Thermal Rcore {name}: {errors:?}"))
        };
        Ok(Self {
            heat_balance: compile("heatBalance")?,
            temperature_rate: compile("temperatureRate")?,
            decay_exponent: compile("decayExponent")?,
            analytic_temperature: compile("analyticTemperature")?,
            bundle,
        })
    }

    pub fn digest(&self) -> &str {
        &self.bundle.sources[0].id.sha256
    }

    fn eval(&self, image: &VerifiedExecutable, inputs: &[f64]) -> Result<f64, String> {
        let program = image.program();
        let signature = &program.functions[program.entry.0 as usize].parameters;
        if signature.len() != inputs.len() || inputs.iter().any(|value| !value.is_finite()) {
            return Err("Invalid Float64 arguments to thermal Rcore".into());
        }
        let arguments: Vec<_> = signature.iter().zip(inputs).map(|(ty, value)| ValueWire {
            ty: *ty,
            data: DataWire::Scalar(ir::Value {
                ty: ir::ValueType::Scalar(Scalar::Float64),
                payload: json!({ "kind": "float64", "bits": format!("{:016x}", value.to_bits()) }),
            }),
        }).collect();
        let result = evaluate(
            image,
            &arguments,
            &ExecutionContext::new(&self.bundle),
            &ExecutionLimits::default(),
        )
        .map_err(|error| error.to_string())?;
        let DataWire::Scalar(ir::Value {
            ty: ir::ValueType::Scalar(Scalar::Float64),
            payload,
        }) = result.value.data
        else {
            return Err("Thermal Rcore returned a different value type".into());
        };
        let bits = payload["bits"]
            .as_str()
            .and_then(|text| u64::from_str_radix(text, 16).ok())
            .ok_or("Invalid Float64 result from thermal Rcore")?;
        let value = f64::from_bits(bits);
        if !value.is_finite() {
            return Err("Non-finite result from thermal Rcore".into());
        }
        Ok(value)
    }

    pub fn balance(&self, inputs: [f64; 4]) -> Result<f64, String> {
        self.eval(&self.heat_balance, &inputs)
    }

    pub fn rate(&self, inputs: [f64; 5]) -> Result<f64, String> {
        self.eval(&self.temperature_rate, &inputs)
    }

    pub fn analytic(&self, inputs: [f64; 6]) -> Result<f64, String> {
        let [power, loss, ambient, initial, seconds, capacity] = inputs;
        let exponent = self.eval(&self.decay_exponent, &[loss, seconds, capacity])?;
        // The scalar VM has no expm1 intrinsic. Supply its primitive result;
        // Rcore computes the exponent and assembles the closed-form equation.
        self.eval(
            &self.analytic_temperature,
            &[
                power,
                loss,
                ambient,
                initial,
                seconds,
                capacity,
                exponent.exp_m1(),
            ],
        )
    }
}
