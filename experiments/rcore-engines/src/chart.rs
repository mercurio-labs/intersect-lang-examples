use crate::{BuiltinEngine, error, metadata, profile, rcore};
use intersect_model::definitions::rcore_behavior::types::Scalar;
use intersect_run::{
    RunError, Time, Trace,
    state_machine::{self, Node, Transition},
};
use serde::Deserialize;

pub use state_machine::{EventId, Scenario, State, StateId, TimedEvent};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartSpec {
    initial: String,
    states: Vec<Node>,
    transitions: Vec<Transition>,
    #[serde(default)]
    immediate: bool,
    #[serde(default)]
    clock_state: Option<String>,
    #[serde(default)]
    guard: Option<String>,
}

pub struct Chart {
    chart: state_machine::Chart,
    guard: Option<rcore::Function>,
}

impl Chart {
    pub fn new(program: &rcore::Program, spec: ChartSpec) -> Result<Self, RunError> {
        let chart = state_machine::Chart::new(state_machine::ChartSpec {
            initial: spec.initial,
            states: spec.states,
            transitions: spec.transitions,
            immediate: spec.immediate,
            clock_state: spec.clock_state,
        })?;
        let guard = spec
            .guard
            .as_deref()
            .map(|name| program.prepare(name))
            .transpose()?;
        if let Some(guard) = &guard {
            guard.check_scalars(&[Scalar::String; 3], Scalar::Bool)?;
        }
        Ok(Self { chart, guard })
    }

    pub fn initial(&self) -> State {
        self.chart.initial()
    }

    pub fn active(state: &State, id: StateId) -> bool {
        state_machine::Chart::active(state, id)
    }

    pub fn active_leaf(&self, state: &State) -> &str {
        self.chart.active_leaf(state)
    }

    pub fn state_id(&self, name: &str) -> Option<StateId> {
        self.chart.state_id(name)
    }

    pub fn event_id(&self, name: &str) -> Option<EventId> {
        self.chart.event_id(name)
    }

    pub fn dispatch(
        &self,
        program: &rcore::Program,
        state: &mut State,
        event: EventId,
        at: Time,
    ) -> Result<bool, RunError> {
        self.chart.dispatch(state, event, at, |from, event, to| {
            self.allows(program, from, event, to)
        })
    }

    pub fn prepare_scenario(&self, events: Vec<TimedEvent>) -> Result<Scenario, RunError> {
        self.chart.prepare_scenario(events)
    }

    pub fn run(&self, program: &rcore::Program, scenario: &Scenario) -> Result<Trace, RunError> {
        self.chart.run(
            scenario,
            &profile(BuiltinEngine::StateMachine.id(), scenario.end(), 1_000),
            metadata(program),
            |from, event, to| self.allows(program, from, event, to),
        )
    }

    fn allows(
        &self,
        program: &rcore::Program,
        from: &str,
        event: &str,
        to: &str,
    ) -> Result<bool, RunError> {
        let Some(guard) = &self.guard else {
            return Ok(true);
        };
        program
            .call(
                guard,
                &[rcore::string(from), rcore::string(event), rcore::string(to)],
            )?
            .as_bool()
            .ok_or_else(|| error("Chart guard did not return Bool"))
    }
}
