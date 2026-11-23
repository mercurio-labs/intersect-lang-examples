use crate::mapping::{Mapping, Objects, Operation, Selection, location};
use intersect_run::analysis::{
    AnalysisError, ErrorCode, Expression, Quantity, Source, Unit, Variables, check, evaluate,
    simulation::{Simulation, SimulationResult, simulate},
    solve,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct Report {
    format: &'static str,
    runner: &'static str,
    pack_sha256: String,
    model_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_pack_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inputs_sha256: Option<String>,
    pub cases: Vec<Case>,
}

impl Report {
    pub fn new(pack_sha256: String, model_sha256: String, cases: Vec<Case>) -> Self {
        Self {
            format: "intersect.analysis.report.v1",
            runner: env!("CARGO_PKG_VERSION"),
            pack_sha256,
            model_sha256,
            body_pack_sha256: None,
            inputs_sha256: None,
            cases,
        }
    }
    pub fn passed(&self) -> bool {
        self.cases
            .iter()
            .all(|case| matches!(case.status, Status::Pass))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pass,
    Fail,
    Error,
}

impl Status {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Error => "ERROR",
        }
    }
}

#[derive(Serialize)]
pub struct Case {
    pub name: String,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<Source>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<AnalysisError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    inputs: Option<Variables>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<ResultValue>,
}

impl Case {
    pub fn error(name: &str, error: AnalysisError) -> Self {
        Self {
            name: name.into(),
            status: Status::Error,
            source: error.source.clone(),
            diagnostic: Some(error),
            inputs: None,
            result: None,
        }
    }

    pub fn result(
        name: &str,
        source: Source,
        result: ResultValue,
        inputs: Variables,
        failure: Option<String>,
    ) -> Self {
        let diagnostic =
            failure.map(|message| AnalysisError::new(ErrorCode::Objective, message, Some(&source)));
        let status = if diagnostic.is_some() {
            Status::Fail
        } else {
            Status::Pass
        };
        Self {
            name: name.into(),
            status,
            source: Some(source),
            diagnostic,
            inputs: Some(inputs),
            result: Some(result),
        }
    }

    pub fn summary(&self) -> Option<String> {
        Some(match self.result.as_ref()? {
            ResultValue::Check { satisfied, .. } => format!("Constraint satisfied: {satisfied}"),
            ResultValue::Solve { unknown, value, .. } => format!("{unknown} = {value}"),
            ResultValue::Sweep {
                parameter, samples, ..
            } => format!("{} values of {parameter}", samples.len()),
            ResultValue::Simulate { simulation, .. } => match simulation.crossing {
                Some(time) => format!("Threshold crossed at {time}"),
                None => "Threshold was not reached".into(),
            },
        })
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResultValue {
    Check {
        backend: &'static str,
        satisfied: bool,
        tolerance: f64,
    },
    Solve {
        backend: &'static str,
        unknown: String,
        value: Quantity,
    },
    Sweep {
        backend: &'static str,
        parameter: String,
        unknown: String,
        samples: Vec<SweepSample>,
    },
    Simulate {
        backend: &'static str,
        deadline: Option<Quantity>,
        simulation: SimulationResult,
    },
}

#[derive(Serialize)]
pub struct SweepSample {
    input: Quantity,
    value: Quantity,
    source: Source,
}

pub const AFFINE: &str = "scalar-affine.v1";

struct Completed {
    result: ResultValue,
    inputs: Variables,
    failure: Option<String>,
}

pub fn execute(mapping: &Mapping, selection: &Selection<'_>, objects: &Objects<'_>) -> Case {
    let source = location(selection.case);
    match evaluate_case(mapping, selection, objects, &source) {
        Ok(completed) => Case::result(
            &selection.name,
            source,
            completed.result,
            completed.inputs,
            completed.failure,
        ),
        Err(error) => Case::error(&selection.name, error),
    }
}

fn evaluate_case(
    mapping: &Mapping,
    selection: &Selection<'_>,
    objects: &Objects<'_>,
    source: &Source,
) -> Result<Completed, AnalysisError> {
    let (result, inputs, failure) = match &selection.mapping.operation {
        Operation::Check {
            constraint,
            tolerance,
        } => {
            let mut constraint = constraint.clone();
            constraint.source = Some(source.clone());
            let variables = mapping.variables(selection, objects, &[])?;
            let satisfied = check(&constraint, &variables, *tolerance)?;
            (
                ResultValue::Check {
                    backend: AFFINE,
                    satisfied,
                    tolerance: *tolerance,
                },
                variables,
                (!satisfied).then(|| "constraint is false".into()),
            )
        }
        Operation::Solve {
            constraint,
            unknown,
        } => {
            let mut constraint = constraint.clone();
            constraint.source = Some(source.clone());
            let variables = mapping.variables(selection, objects, &[unknown])?;
            let value = solve(&constraint, &variables, unknown)?;
            (
                ResultValue::Solve {
                    backend: AFFINE,
                    unknown: unknown.clone(),
                    value,
                },
                variables,
                None,
            )
        }
        Operation::Sweep {
            constraint,
            unknown,
            parameter,
            samples,
        } => {
            let mut constraint = constraint.clone();
            let inputs = mapping.variables(selection, objects, &[unknown, parameter])?;
            let mut variables = inputs.clone();
            let variable = inputs.get(parameter).ok_or_else(|| {
                AnalysisError::new(
                    ErrorCode::Unbound,
                    format!("undeclared parameter {parameter}"),
                    Some(source),
                )
            })?;
            let unit = variable.unit;
            let samples = mapping
                .sweep_values(selection, samples, objects)?
                .into_iter()
                .map(|(input, source)| {
                    let variable = variables.get_mut(parameter).ok_or_else(|| {
                        AnalysisError::new(
                            ErrorCode::Unbound,
                            format!("undeclared parameter {parameter}"),
                            Some(&source),
                        )
                    })?;
                    variable.value = Some(input.in_unit(unit, Some(&source))?);
                    variable.source = Some(source.clone());
                    constraint.source = Some(source.clone());
                    Ok(SweepSample {
                        input,
                        value: solve(&constraint, &variables, unknown)?,
                        source,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            (
                ResultValue::Sweep {
                    backend: AFFINE,
                    parameter: parameter.clone(),
                    unknown: unknown.clone(),
                    samples,
                },
                inputs,
                None,
            )
        }
        Operation::Simulate {
            initial,
            rate,
            threshold,
            next_rate,
            end,
            interval,
            deadline,
        } => {
            let variables = mapping.variables(selection, objects, &[])?;
            let get = |name, unit| variable(name, unit, &variables, source);
            let deadline = deadline
                .as_ref()
                .map(|name| get(name, Unit::Second))
                .transpose()?;
            let simulation = simulate(&Simulation {
                initial: get(initial, Unit::Litre)?,
                rate: get(rate, Unit::LitresPerSecond)?,
                threshold: get(threshold, Unit::Litre)?,
                next_rate: evaluate(next_rate, &variables, Unit::LitresPerSecond, Some(source))?,
                end: get(end, Unit::Second)?,
                interval: get(interval, Unit::Second)?,
                source: Some(source.clone()),
            })?;
            let failure = deadline.and_then(|deadline| match simulation.crossing {
                Some(crossing) if crossing.value <= deadline.value => None,
                Some(crossing) => Some(format!(
                    "threshold at {} s exceeds deadline {} s",
                    crossing.value, deadline.value
                )),
                None => Some(format!("threshold was not reached by {} s", deadline.value)),
            });
            (
                ResultValue::Simulate {
                    backend: "constant-rate.v1",
                    deadline,
                    simulation,
                },
                variables,
                failure,
            )
        }
    };
    Ok(Completed {
        result,
        inputs,
        failure,
    })
}

fn variable(
    name: &str,
    unit: Unit,
    variables: &Variables,
    source: &Source,
) -> Result<Quantity, AnalysisError> {
    evaluate(
        &Expression::Variable { name: name.into() },
        variables,
        unit,
        Some(source),
    )
}
