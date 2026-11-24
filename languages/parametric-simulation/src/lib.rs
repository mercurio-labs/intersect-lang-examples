//! Heated enclosure Run profile shared by the native CLI and browser worker.
mod equations;
#[cfg(target_arch = "wasm32")]
mod wasm;

use equations::Equations;
use intersect_run::{
    Budgets, EndReason, EventEffect, Input, Parameters, Policy, Profile, RunCase, RunCases,
    RunError, Semantics, StepContext, Trace, TraceKind, TraceMetadata,
    numerics::{NumericError, bisect, rk4},
    run_cases,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const AMBIENT: f64 = 20.0;
const INITIAL: f64 = 20.0;
const CAPACITY: f64 = 1200.0;
const TARGET: f64 = 40.0;
const SAMPLE_SECONDS: u64 = 15;
const DURATION_SECONDS: u64 = 1800;
const PROFILE_ID: &str = "urn:intersect:example:heated-enclosure:1";
const MAX_POWER: f64 = 250.0;
const MAX_LOSS: f64 = 15.0;
const LOSS_STEP: f64 = 0.5;
const RESIDUAL_TOLERANCE_W: f64 = 1e-9;
const BISECTION_ITERATIONS: u32 = 64;
const MAX_STEP_SECONDS: f64 = 2.0;
const MAX_SUBSTEPS: u32 = 8;

pub fn configuration() -> Value {
    json!({
        "ambient": AMBIENT, "initial": INITIAL, "heatCapacity": CAPACITY,
        "target": TARGET, "sampleSeconds": SAMPLE_SECONDS, "duration": DURATION_SECONDS / 60,
        "baseline": Inputs::BASELINE, "equationSource": equations::SOURCE,
        "limits": {
            "power": { "min": 0, "max": MAX_POWER, "step": 5 },
            "loss": { "min": 0, "max": MAX_LOSS, "step": LOSS_STEP }
        }
    })
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inputs {
    pub power: f64,
    pub loss: f64,
}

impl Inputs {
    pub const BASELINE: Self = Self {
        power: 120.0,
        loss: 5.0,
    };

    fn checked(self) -> Result<Self, RunError> {
        if !(0.0..=MAX_POWER).contains(&self.power) {
            return Err(RunError::Semantics(
                "Heater power must be 0 to 250 W".into(),
            ));
        }
        if self.loss != 0.0 && !(LOSS_STEP..=MAX_LOSS).contains(&self.loss) {
            return Err(RunError::Semantics(
                "Heat loss must be zero or 0.5 to 15 W/°C".into(),
            ));
        }
        Ok(self)
    }

    fn parameters(self) -> Parameters {
        [
            ("power".into(), json!(self.power)),
            ("loss".into(), json!(self.loss)),
        ]
        .into()
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Analytic,
    Ode,
}

impl Method {
    fn id(self) -> &'static str {
        match self {
            Self::Analytic => "analytic",
            Self::Ode => "rk4",
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub method: Method,
    pub current: Inputs,
}

#[derive(Serialize)]
pub struct Comparison {
    pub cases: Vec<ThermalRun>,
}

#[derive(Serialize)]
pub struct ThermalRun {
    pub case: RunCase,
    pub trace: Trace,
    pub reason: EndReason,
    pub summary: Summary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub equilibrium: Equilibrium,
    pub target_seconds: Option<f64>,
    pub target_reachable: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Equilibrium {
    Solved { celsius: f64 },
    NoFiniteSolution,
    Underdetermined,
}

struct Thermal<'a> {
    equations: &'a Equations,
    inputs: Inputs,
    method: Method,
}

struct State {
    seconds: u64,
    celsius: f64,
    equilibrium: Equilibrium,
    target_reachable: bool,
}

#[derive(Debug)]
struct Sample;

fn solver_error(error: impl std::fmt::Display) -> RunError {
    RunError::Semantics(error.to_string())
}

// The numeric helpers stop on a non-finite callback result. Keep the
// underlying checked-language diagnostic when that stop came from the VM.
fn solve_checked<T>(
    mut equation: impl FnMut(f64) -> Result<f64, String>,
    solve: impl FnOnce(&mut dyn FnMut(f64) -> f64) -> Result<T, NumericError>,
) -> Result<T, RunError> {
    let mut failure = None;
    let outcome = solve(&mut |input| match equation(input) {
        Ok(value) => value,
        Err(error) => {
            failure = Some(error);
            f64::NAN
        }
    });
    match failure {
        Some(error) => Err(solver_error(error)),
        None => outcome.map_err(solver_error),
    }
}

impl Thermal<'_> {
    fn residual(&self, celsius: f64) -> Result<f64, String> {
        self.equations
            .balance([self.inputs.power, self.inputs.loss, celsius, AMBIENT])
    }

    fn equilibrium(&self) -> Result<Equilibrium, RunError> {
        if self.inputs.loss == 0.0 {
            return Ok(if self.inputs.power > 0.0 {
                Equilibrium::NoFiniteSolution
            } else {
                Equilibrium::Underdetermined
            });
        }
        let celsius = solve_checked(
            |temperature| self.residual(temperature),
            |residual| {
                bisect(
                    AMBIENT,
                    AMBIENT + 600.0,
                    RESIDUAL_TOLERANCE_W,
                    BISECTION_ITERATIONS,
                    residual,
                )
            },
        )?;
        Ok(Equilibrium::Solved { celsius })
    }

    fn analytic_temperature(&self, seconds: u64) -> Result<f64, RunError> {
        self.equations
            .analytic([
                self.inputs.power,
                self.inputs.loss,
                AMBIENT,
                INITIAL,
                seconds as f64,
                CAPACITY,
            ])
            .map_err(solver_error)
    }
}

impl Semantics for Thermal<'_> {
    type State = State;
    type Step = ();
    type Event = Sample;

    fn initial(&self) -> Result<State, RunError> {
        Ok(State {
            seconds: 0,
            celsius: INITIAL,
            equilibrium: self.equilibrium()?,
            target_reachable: self.residual(TARGET).map_err(solver_error)? > 0.0,
        })
    }

    fn enabled(&self, _: &State, _: u64) -> Result<Vec<()>, RunError> {
        Ok(vec![])
    }

    fn fire(&self, _: &mut State, _: &(), _: &mut StepContext<'_, Sample>) -> Result<(), RunError> {
        Err(RunError::Semantics(
            "The thermal profile only advances on a scheduled sample".into(),
        ))
    }

    fn on_event(
        &self,
        state: &mut State,
        _: &Sample,
        context: &mut StepContext<'_, Sample>,
    ) -> Result<EventEffect, RunError> {
        let time = context.now();
        state.celsius = match self.method {
            Method::Analytic => self.analytic_temperature(time)?,
            Method::Ode => {
                let values = solve_checked(
                    |temperature| {
                        self.equations.rate([
                            self.inputs.power,
                            self.inputs.loss,
                            temperature,
                            AMBIENT,
                            CAPACITY,
                        ])
                    },
                    |rate| {
                        rk4(
                            state.seconds as f64,
                            time as f64,
                            &[state.celsius],
                            MAX_STEP_SECONDS,
                            MAX_SUBSTEPS,
                            |_, value, derivative| derivative[0] = rate(value[0]),
                        )
                    },
                )?;
                values[0]
            }
        };
        state.seconds = time;
        Ok(EventEffect::Applied)
    }

    fn observe(&self, state: &State) -> Result<Value, RunError> {
        Ok(json!({"temperatureC":state.celsius}))
    }
}

fn target_crossing(trace: &Trace) -> Option<f64> {
    let mut previous = (0.0, INITIAL);
    for entry in &trace.entries {
        if entry.kind != TraceKind::EventDelivered {
            continue;
        }
        let temperature = entry.observation.as_ref()?.get("temperatureC")?.as_f64()?;
        let time = entry.time as f64;
        if temperature >= TARGET {
            return Some(
                previous.0
                    + (time - previous.0) * (TARGET - previous.1) / (temperature - previous.1),
            );
        }
        previous = (time, temperature);
    }
    None
}

pub fn compare(request: Request) -> Result<Comparison, RunError> {
    Equations::with(|equations| compare_with(equations, request))
}

fn compare_with(equations: &Equations, request: Request) -> Result<Comparison, RunError> {
    let method = request.method;
    let inputs = request.current.checked()?;
    let cases = RunCases::explicit(
        [("baseline", Inputs::BASELINE), ("current", inputs)]
            .into_iter()
            .map(|(id, parameters)| RunCase {
                id: id.into(),
                parameters: parameters.parameters(),
            })
            .collect(),
        2,
    )
    .map_err(solver_error)?;
    let profile = Profile {
        name: "Heated enclosure".into(),
        language_profile: format!("{PROFILE_ID}:{}", method.id()),
        nanos_per_tick: 1_000_000_000,
        policy: Policy::First,
        seed: 0,
        budgets: Budgets {
            steps_per_instant: 1,
            total_steps: 1,
            events: DURATION_SECONDS / SAMPLE_SECONDS,
            end_time: DURATION_SECONDS + 1,
        },
    };
    let metadata = TraceMetadata {
        model_digest: Some(equations.digest().into()),
        language_data: Some(json!({
            "ambientC":AMBIENT, "initialC":INITIAL, "thermalCapacity":CAPACITY, "targetC":TARGET,
            "sampleSeconds":SAMPLE_SECONDS, "durationSeconds":DURATION_SECONDS,
            "equations": { "language": "Rcore", "source": equations::URI },
            "equilibrium": {
                "solver": "bisection", "residualToleranceW": RESIDUAL_TOLERANCE_W,
                "maxIterations": BISECTION_ITERATIONS,
            },
            "transient": match method {
                Method::Analytic => json!({ "solver": "analytic" }),
                Method::Ode => json!({
                    "solver": "rk4", "maxStepSeconds": MAX_STEP_SECONDS,
                    "maxSubstepsPerSample": MAX_SUBSTEPS,
                }),
            },
        })),
    };
    let completed = run_cases(&cases, &profile, metadata, |parameters| {
        let values = serde_json::from_value::<Inputs>(json!(parameters))
            .map_err(solver_error)?
            .checked()?;
        let events = (SAMPLE_SECONDS..=DURATION_SECONDS)
            .step_by(SAMPLE_SECONDS as usize)
            .map(|time| Input {
                time,
                event: Sample,
            });
        Ok((
            Thermal {
                equations,
                inputs: values,
                method,
            },
            events,
        ))
    })
    .map(|case| {
        let (outcome, trace) = case.result?;
        if outcome.reason != EndReason::Quiescence
            || outcome.events != DURATION_SECONDS / SAMPLE_SECONDS
        {
            return Err(RunError::Semantics(
                "The thermal run ended before all samples were recorded".into(),
            ));
        }
        let summary = Summary {
            equilibrium: outcome.state.equilibrium,
            target_seconds: target_crossing(&trace),
            target_reachable: outcome.state.target_reachable,
        };
        Ok(ThermalRun {
            case: case.case.clone(),
            trace,
            reason: outcome.reason,
            summary,
        })
    })
    .collect::<Result<Vec<_>, RunError>>()?;
    Ok(Comparison { cases: completed })
}
