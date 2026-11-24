use crate::{BuiltinEngine, CaseTrace, ParameterOverrides, chart, error, metadata, profile, rcore};
use intersect_model::definitions::rcore_behavior::types::Scalar;
use intersect_run::{
    EndReason, EventEffect, Input, RunError, Semantics, StepContext, Time,
    numerics::{first_crossing_tick, rk4},
    run_traced,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fmt};

const MAX_EVENTS: u64 = 8_192;
const MAX_SUBSTEPS: u32 = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    end_ms: Time,
    sample_ms: Time,
    max_step_ms: Time,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Variable {
    name: String,
    initial: f64,
    derivative: String,
    arguments: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CaseSpec {
    name: String,
    parameters: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Crossing {
    variable: String,
    level: f64,
    rising: bool,
    event: String,
}

struct Monitor {
    index: usize,
    level: f64,
    rising: bool,
    event: chart::EventId,
    event_name: String,
}

impl Monitor {
    fn crossed(&self, left: &[f64], right: &[f64]) -> bool {
        if self.rising {
            left[self.index] < self.level && right[self.index] >= self.level
        } else {
            left[self.index] > self.level && right[self.index] <= self.level
        }
    }
}

enum Argument {
    Seconds,
    State(usize),
    Parameter(usize),
    Active(chart::StateId),
}

struct Derivative {
    function: rcore::Function,
    arguments: Vec<Argument>,
}

struct System {
    settings: Settings,
    variables: Vec<Variable>,
    derivatives: Vec<Derivative>,
    controller: Option<chart::Chart>,
    monitors: Vec<Monitor>,
    engine: BuiltinEngine,
    parameters: BTreeMap<String, usize>,
}

struct State {
    values: Vec<f64>,
    chart: Option<chart::State>,
    sample: bool,
    crossed: Vec<String>,
}

struct Boundary {
    at: Time,
    values: Vec<f64>,
    monitors: Vec<usize>,
}

struct Case {
    name: String,
    parameters: Vec<f64>,
}

pub struct Prepared {
    system: System,
    cases: Vec<Case>,
}

struct Model<'a> {
    program: &'a rcore::Program<'a>,
    system: &'a System,
    case: &'a Case,
}

impl Prepared {
    pub fn new(
        program: &rcore::Program,
        engine: BuiltinEngine,
        mut overrides: ParameterOverrides,
    ) -> Result<Self, RunError> {
        let system = System::new(program, engine)?;
        let specs: Vec<CaseSpec> = program.member("cases")?;
        if specs.is_empty() || specs.len() > 32 {
            return Err(error("ODE profile needs one to 32 cases"));
        }
        let mut names = std::collections::BTreeSet::new();
        let mut cases = Vec::with_capacity(specs.len());
        for mut case in specs {
            if case.name.is_empty() || !names.insert(case.name.clone()) {
                return Err(error("ODE case names must be nonempty and unique"));
            }
            for (name, value) in overrides.remove(&case.name).unwrap_or_default() {
                let declared = case.parameters.get_mut(&name).ok_or_else(|| {
                    error(format!("Unknown parameter {name} in case {}", case.name))
                })?;
                if !value.is_finite() {
                    return Err(error(format!(
                        "Parameter {name} in case {} must be finite",
                        case.name
                    )));
                }
                *declared = value;
            }
            let mut parameters = vec![0.0; system.parameters.len()];
            for (name, &index) in &system.parameters {
                parameters[index] = *case.parameters.get(name).ok_or_else(|| {
                    error(format!("Case {} is missing parameter {name}", case.name))
                })?;
            }
            cases.push(Case {
                name: case.name,
                parameters,
            });
        }
        if let Some(name) = overrides.keys().next() {
            return Err(error(format!("Unknown ODE case {name}")));
        }
        Ok(Self { system, cases })
    }

    pub fn run(&self, program: &rcore::Program) -> Result<Vec<CaseTrace>, RunError> {
        self.cases
            .iter()
            .map(|case| {
                Model {
                    program,
                    system: &self.system,
                    case,
                }
                .run()
            })
            .collect()
    }
}

impl System {
    fn new(program: &rcore::Program, engine: BuiltinEngine) -> Result<Self, RunError> {
        let settings: Settings = program.member("settings")?;
        if settings.sample_ms == 0
            || settings.max_step_ms == 0
            || settings.max_step_ms > 86_400_000
            || settings.end_ms == 0
            || settings.end_ms > 86_400_000
            || !settings.end_ms.is_multiple_of(settings.sample_ms)
            || settings.end_ms / settings.sample_ms > MAX_EVENTS / 2
            || settings.sample_ms.div_ceil(settings.max_step_ms) > u64::from(MAX_SUBSTEPS)
        {
            return Err(error("Invalid ODE clock, sample grid, or work limits"));
        }
        let variables: Vec<Variable> = program.member("variables")?;
        let indexes: BTreeMap<_, _> = variables
            .iter()
            .enumerate()
            .map(|(index, var)| (var.name.as_str(), index))
            .collect();
        if variables.is_empty()
            || variables.len() > 16
            || indexes.len() != variables.len()
            || indexes.contains_key("")
        {
            return Err(error("ODE needs one to 16 uniquely named state variables"));
        }
        let (controller, monitors) = if engine == BuiltinEngine::CoupledOde {
            let controller = chart::Chart::new(program, program.member("chart")?)?;
            let crossings: Vec<Crossing> = program.member("crossings")?;
            if crossings.is_empty() || crossings.len() > 16 {
                return Err(error("Coupled ODE needs one to 16 crossing monitors"));
            }
            let monitors = crossings
                .into_iter()
                .map(|crossing| {
                    let index = *indexes.get(crossing.variable.as_str()).ok_or_else(|| {
                        error(format!("Unknown monitor variable {}", crossing.variable))
                    })?;
                    let event = controller.event_id(&crossing.event).ok_or_else(|| {
                        error(format!("Unbound crossing event {}", crossing.event))
                    })?;
                    Ok(Monitor {
                        index,
                        level: crossing.level,
                        rising: crossing.rising,
                        event,
                        event_name: crossing.event,
                    })
                })
                .collect::<Result<Vec<_>, RunError>>()?;
            (Some(controller), monitors)
        } else {
            (None, vec![])
        };
        let mut parameters = BTreeMap::new();
        let derivatives = variables
            .iter()
            .map(|variable| {
                let args = variable
                    .arguments
                    .iter()
                    .map(|argument| {
                        match argument.split_once('.') {
                            Some(("state", name)) => {
                                indexes.get(name).copied().map(Argument::State)
                            }
                            Some(("parameter", name)) if !name.is_empty() => {
                                let next = parameters.len();
                                Some(Argument::Parameter(
                                    *parameters.entry(name.into()).or_insert(next),
                                ))
                            }
                            Some(("active", name)) => controller
                                .as_ref()
                                .and_then(|chart| chart.state_id(name))
                                .map(Argument::Active),
                            None if argument == "seconds" => Some(Argument::Seconds),
                            _ => None,
                        }
                        .ok_or_else(|| error(format!("Invalid derivative binding {argument}")))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let types = args
                    .iter()
                    .map(|arg| match arg {
                        Argument::Active(_) => Scalar::Bool,
                        _ => Scalar::Float64,
                    })
                    .collect::<Vec<_>>();
                let function = program.prepare(&variable.derivative)?;
                function.check_scalars(&types, Scalar::Float64)?;
                Ok(Derivative {
                    function,
                    arguments: args,
                })
            })
            .collect::<Result<Vec<_>, RunError>>()?;

        Ok(Self {
            settings,
            variables,
            derivatives,
            controller,
            monitors,
            engine,
            parameters,
        })
    }

    fn next_sample(&self, current: Time) -> Option<Time> {
        let next = (current / self.settings.sample_ms + 1) * self.settings.sample_ms;
        (next <= self.settings.end_ms).then_some(next)
    }
}

impl Model<'_> {
    fn integrate(
        &self,
        state: &State,
        at: Time,
        until: Time,
        values: &[f64],
    ) -> Result<Vec<f64>, RunError> {
        let mut callback_error = None;
        let values = rk4(
            0.0,
            (until - at) as f64,
            values,
            self.system.settings.max_step_ms as f64,
            MAX_SUBSTEPS,
            |offset, values, slopes| {
                let seconds = (at as f64 + offset) / 1_000.0;
                for (derivative, slope) in self.system.derivatives.iter().zip(slopes) {
                    match self.derivative(state, derivative, seconds, values) {
                        Ok(value) => *slope = value / 1_000.0,
                        Err(error) => {
                            callback_error = Some(error);
                            break;
                        }
                    }
                }
            },
        );
        match callback_error {
            Some(error) => Err(error),
            None => values.map_err(error),
        }
    }

    fn derivative(
        &self,
        state: &State,
        derivative: &Derivative,
        seconds: f64,
        values: &[f64],
    ) -> Result<f64, RunError> {
        let arguments = derivative
            .arguments
            .iter()
            .map(|argument| match argument {
                Argument::Seconds => rcore::float(seconds),
                Argument::State(index) => rcore::float(values[*index]),
                Argument::Parameter(index) => rcore::float(self.case.parameters[*index]),
                Argument::Active(id) => rcore::boolean(
                    state
                        .chart
                        .as_ref()
                        .is_some_and(|state| chart::Chart::active(state, *id)),
                ),
            })
            .collect::<Vec<_>>();
        self.program
            .call(&derivative.function, &arguments)?
            .as_f64()
            .ok_or_else(|| error("Derivative must return Float64"))
    }

    fn locate_crossing(
        &self,
        state: &State,
        monitor: &Monitor,
        at: Time,
        until: Time,
        values: &[f64],
    ) -> Result<Time, RunError> {
        first_crossing_tick(at, until, |midpoint| {
            Ok(monitor.crossed(values, &self.integrate(state, at, midpoint, values)?))
        })
    }

    fn plan(&self, state: &State, current: Time) -> Result<Option<Boundary>, RunError> {
        let Some(sample) = self.system.next_sample(current) else {
            return Ok(None);
        };
        let mut values = state.values.clone();
        if self.system.monitors.is_empty() {
            return Ok(Some(Boundary {
                at: sample,
                values: self.integrate(state, current, sample, &values)?,
                monitors: vec![],
            }));
        }

        let mut at = current;
        while at < sample {
            let next = sample.min(at + self.system.settings.max_step_ms);
            let integrated = self.integrate(state, at, next, &values)?;
            let mut hits = Vec::new();
            for (index, monitor) in self.system.monitors.iter().enumerate() {
                if monitor.crossed(&values, &integrated) {
                    hits.push((
                        self.locate_crossing(state, monitor, at, next, &values)?,
                        index,
                    ));
                }
            }
            if let Some(first) = hits.iter().map(|(tick, _)| *tick).min() {
                let monitors = hits
                    .into_iter()
                    .filter(|(tick, _)| *tick == first)
                    .map(|(_, index)| index)
                    .collect();
                return Ok(Some(Boundary {
                    at: first,
                    values: self.integrate(state, at, first, &values)?,
                    monitors,
                }));
            }
            at = next;
            values = integrated;
        }
        Ok(Some(Boundary {
            at: sample,
            values,
            monitors: vec![],
        }))
    }

    fn run(&self) -> Result<CaseTrace, RunError> {
        let inputs = self
            .plan(&self.initial()?, 0)?
            .into_iter()
            .map(|event| Input {
                time: event.at,
                event,
            });
        let (outcome, trace) = run_traced(
            self,
            &profile(
                self.system.engine.id(),
                self.system.settings.end_ms + 1,
                MAX_EVENTS,
            ),
            inputs,
            metadata(self.program),
        )?;
        if outcome.reason != EndReason::Quiescence || outcome.time != self.system.settings.end_ms {
            return Err(error(format!(
                "ODE run ended early at {}: {:?}",
                outcome.time, outcome.reason
            )));
        }
        Ok(CaseTrace {
            case: self.case.name.clone(),
            trace,
        })
    }
}

impl fmt::Debug for Boundary {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.monitors.is_empty() {
            out.write_str("sample")
        } else {
            out.write_str("crossing")
        }
    }
}

impl Semantics for Model<'_> {
    type State = State;
    type Step = ();
    type Event = Boundary;

    fn initial(&self) -> Result<State, RunError> {
        Ok(State {
            values: self
                .system
                .variables
                .iter()
                .map(|var| var.initial)
                .collect(),
            chart: self.system.controller.as_ref().map(chart::Chart::initial),
            sample: true,
            crossed: vec![],
        })
    }

    fn enabled(&self, _: &State, _: Time) -> Result<Vec<()>, RunError> {
        Ok(vec![])
    }

    fn fire(
        &self,
        _: &mut State,
        _: &(),
        _: &mut StepContext<'_, Boundary>,
    ) -> Result<(), RunError> {
        Err(error("ODE advances on scheduled boundaries"))
    }

    fn on_event(
        &self,
        state: &mut State,
        boundary: &Boundary,
        context: &mut StepContext<'_, Boundary>,
    ) -> Result<EventEffect, RunError> {
        state.values.clone_from(&boundary.values);
        state.sample = boundary.at.is_multiple_of(self.system.settings.sample_ms);
        state.crossed.clear();
        if let (Some(chart), Some(controller)) = (&self.system.controller, &mut state.chart) {
            for &index in &boundary.monitors {
                let monitor = &self.system.monitors[index];
                if chart.dispatch(self.program, controller, monitor.event, boundary.at)? {
                    state.crossed.push(monitor.event_name.clone());
                }
            }
        }
        if let Some(future) = self.plan(state, boundary.at)? {
            context.schedule_at(future.at, 0, future)?;
        }
        Ok(EventEffect::Applied)
    }

    fn observe(&self, state: &State) -> Result<Value, RunError> {
        let values: BTreeMap<_, _> = self
            .system
            .variables
            .iter()
            .zip(&state.values)
            .map(|(variable, value)| (variable.name.as_str(), value))
            .collect();
        let mode = self
            .system
            .controller
            .as_ref()
            .zip(state.chart.as_ref())
            .map(|(chart, state)| chart.active_leaf(state));
        Ok(
            json!({ "values": values, "sample": state.sample, "mode": mode, "crossed": state.crossed }),
        )
    }
}
