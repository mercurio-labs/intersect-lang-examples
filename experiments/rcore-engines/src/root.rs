use crate::{error, rcore};
use intersect_model::definitions::rcore_behavior::types::Scalar;
use intersect_run::{RunError, numerics::bisect};
use intersect_run_catalog::Engine;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Problem {
    name: String,
    lower: f64,
    upper: f64,
    tolerance: f64,
    iterations: u32,
    arguments: Vec<f64>,
}

#[derive(Serialize)]
pub struct Solution {
    pub case: String,
    pub root: f64,
}

pub fn run(uri: &str, source: &str) -> Result<Vec<Solution>, RunError> {
    let program = rcore::Program::new(uri, source, None)?;
    let engine: String = program.member("engine")?;
    if Engine::select(&engine, &[Engine::ScalarRoot]).is_none() {
        return Err(error(format!("Root engine {engine} is unavailable")));
    }
    let problems: Vec<Problem> = program.member("problems")?;
    if problems.is_empty() || problems.len() > 32 {
        return Err(error("Root solver needs one to 32 problems"));
    }
    let name: String = program.member("residual")?;
    let residual = program.prepare(&name)?;
    problems
        .into_iter()
        .map(|problem| {
            if problem.iterations > 128 || problem.arguments.len() > 16 {
                return Err(error("Root solver work limit exceeded"));
            }
            residual.check_scalars(
                &vec![Scalar::Float64; 1 + problem.arguments.len()],
                Scalar::Float64,
            )?;
            let mut failure = None;
            let root = bisect(
                problem.lower,
                problem.upper,
                problem.tolerance,
                problem.iterations,
                |candidate| {
                    let arguments = std::iter::once(candidate)
                        .chain(problem.arguments.iter().copied())
                        .map(rcore::float)
                        .collect::<Vec<_>>();
                    match program.call(&residual, &arguments).and_then(|value| {
                        value
                            .as_f64()
                            .ok_or_else(|| error("Residual must return Float64"))
                    }) {
                        Ok(value) => value,
                        Err(issue) => {
                            failure = Some(issue);
                            f64::NAN
                        }
                    }
                },
            );
            if let Some(issue) = failure {
                return Err(issue);
            }
            Ok(Solution {
                case: problem.name,
                root: root.map_err(error)?,
            })
        })
        .collect()
}
