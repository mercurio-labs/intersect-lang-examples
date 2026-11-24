mod chart;
mod ode;
pub mod pack;
mod rcore;
mod root;
#[path = "../../../languages/petri/src/engine.rs"]
mod token_flow;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use chart::TimedEvent;
use intersect_run::{Budgets, Policy, Profile, RunError, Time, Trace, TraceMetadata};
use intersect_run_catalog::{Engine as BuiltinEngine, HostEngine, RequestCapability};
pub use rcore::ModelBinding;
pub use root::{Solution, run as solve_root_source};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct CaseTrace {
    pub case: String,
    pub trace: Trace,
}

/// Request-side numeric inputs, grouped by authored ODE case name.
pub type ParameterOverrides = BTreeMap<String, BTreeMap<String, f64>>;

/// Inputs supplied by a run request. Missing fields use the Rcore defaults.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct RunInputs {
    pub parameters: ParameterOverrides,
    pub events: Option<Vec<TimedEvent>>,
}

const PACKAGED_ENGINES: &[HostEngine] = &[
    HostEngine::new(
        BuiltinEngine::StateMachine,
        &[RequestCapability::ScenarioEvents],
    ),
    HostEngine::new(
        BuiltinEngine::Ode,
        &[RequestCapability::NumericCaseOverrides],
    ),
    HostEngine::new(
        BuiltinEngine::CoupledOde,
        &[RequestCapability::NumericCaseOverrides],
    ),
    HostEngine::new(BuiltinEngine::TimedTokenFlow, &[]),
];

fn packaged_engine(id: &str) -> Result<HostEngine, RunError> {
    HostEngine::select(id, PACKAGED_ENGINES)
        .ok_or_else(|| error(format!("Engine {id} is unavailable")))
}

/// Check whether this Run host provides the exact declared engine contract.
pub fn check_builtin_engine(engine: &str) -> Result<(), RunError> {
    packaged_engine(engine).map(|_| ())
}

/// A validated execution plan. It retains compiled callbacks and uses fresh
/// engine state for each run.
pub struct PreparedProfile<'a> {
    program: rcore::Program<'a>,
    plan: Plan,
}

enum Plan {
    Chart(chart::Chart, chart::Scenario),
    Ode(ode::Prepared),
    TokenFlow(token_flow::TimedPetri, Profile, token_flow::Scenario),
}

/// Resolve the manifest-selected engine, compile Rcore mappings and callbacks,
/// and validate the request before Run schedules any work.
pub fn prepare_declared_profile<'a>(
    uri: &str,
    source: &str,
    engine: &str,
    binding: Option<ModelBinding<'a>>,
    inputs: RunInputs,
) -> Result<PreparedProfile<'a>, RunError> {
    let engine = packaged_engine(engine)?;
    let program = rcore::Program::new(uri, source, binding)?;
    prepare(program, engine, inputs)
}

impl PreparedProfile<'_> {
    pub fn run(&self) -> Result<Vec<CaseTrace>, RunError> {
        let trace = match &self.plan {
            Plan::Chart(chart, scenario) => chart.run(&self.program, scenario)?,
            Plan::Ode(system) => return system.run(&self.program),
            Plan::TokenFlow(model, profile, scenario) => {
                let scenario = token_flow::Scenario {
                    inputs: scenario
                        .inputs
                        .iter()
                        .map(|item| token_flow::ScenarioInput {
                            at_ms: item.at_ms,
                            transition: item.transition.clone(),
                        })
                        .collect(),
                };
                model
                    .execute(profile, scenario, Some(self.program.digest().into()))?
                    .1
            }
        };
        Ok(vec![CaseTrace {
            case: "default".into(),
            trace,
        }])
    }
}

pub fn run_source(uri: &str, source: &str) -> Result<Vec<CaseTrace>, RunError> {
    run_profile(uri, source, None)
}

pub fn run_model_source(
    uri: &str,
    source: &str,
    binding: ModelBinding<'_>,
) -> Result<Vec<CaseTrace>, RunError> {
    run_profile(uri, source, Some(binding))
}

fn run_profile(
    uri: &str,
    source: &str,
    binding: Option<ModelBinding<'_>>,
) -> Result<Vec<CaseTrace>, RunError> {
    let program = rcore::Program::new(uri, source, binding)?;
    let engine: String = program.member("engine")?;
    prepare(program, packaged_engine(&engine)?, RunInputs::default())?.run()
}

fn prepare(
    program: rcore::Program<'_>,
    registration: HostEngine,
    inputs: RunInputs,
) -> Result<PreparedProfile<'_>, RunError> {
    let engine = registration.engine();
    if inputs.events.is_some() && !registration.accepts(RequestCapability::ScenarioEvents) {
        return Err(error(format!(
            "Engine {} does not accept a scenario event override",
            engine.id()
        )));
    }
    if !inputs.parameters.is_empty()
        && !registration.accepts(RequestCapability::NumericCaseOverrides)
    {
        return Err(error(format!(
            "Engine {} does not accept numeric case overrides",
            engine.id()
        )));
    }
    let plan = match engine {
        BuiltinEngine::StateMachine => {
            let chart = chart::Chart::new(&program, program.member("chart")?)?;
            let events = match inputs.events {
                Some(events) => events,
                None => program.member("scenario")?,
            };
            let scenario = chart.prepare_scenario(events)?;
            Plan::Chart(chart, scenario)
        }
        BuiltinEngine::Ode | BuiltinEngine::CoupledOde => {
            Plan::Ode(ode::Prepared::new(&program, engine, inputs.parameters)?)
        }
        BuiltinEngine::TimedTokenFlow => {
            let config: TokenRun = program.member("settings")?;
            const MAX_OBSERVATION_BYTES: usize = 4 * 1024 * 1024;
            let model = token_flow::TimedPetri::from_net(program.member("net")?)?
                .with_observation_byte_limit(MAX_OBSERVATION_BYTES);
            let profile = token_flow::profile(config.policy, config.seed, config.until);
            Plan::TokenFlow(model, profile, program.member("scenario")?)
        }
        _ => return Err(error(format!("Engine {} is unavailable", engine.id()))),
    };
    Ok(PreparedProfile { program, plan })
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenRun {
    policy: Policy,
    seed: u64,
    until: Time,
}

fn error(message: impl ToString) -> RunError {
    RunError::Semantics(message.to_string())
}

fn profile(engine: &str, end_time: Time, events: u64) -> Profile {
    Profile {
        name: engine.into(),
        language_profile: engine.into(),
        nanos_per_tick: Profile::NANOS_PER_MILLISECOND,
        policy: Policy::First,
        seed: 0,
        budgets: Budgets {
            steps_per_instant: 1_000,
            total_steps: 50_000,
            events,
            end_time,
        },
    }
}

fn metadata(program: &rcore::Program) -> TraceMetadata {
    TraceMetadata {
        model_digest: Some(program.digest().into()),
        language_data: None,
    }
}
