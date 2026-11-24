// Timed token-flow engine shared by the checked-model adapter and the Rcore experiment.
use intersect_run::{
    Budgets, EventEffect, Input, Policy, Profile, RunError, RunOutcome, Semantics, StepContext,
    Time, Trace, TraceMetadata, run_traced,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fmt};

pub const PROFILE_ID: &str = "petri.timed-firing.v1";

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Place {
    pub id: String,
    pub name: String,
    pub tokens: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Arc {
    pub place: String,
    pub weight: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub id: String,
    pub name: String,
    pub external: bool,
    pub delay_ms: u64,
    pub inputs: Vec<Arc>,
    pub outputs: Vec<Arc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Net {
    pub name: String,
    pub places: Vec<Place>,
    pub transitions: Vec<Transition>,
}

pub struct TimedPetri {
    net: Net,
    /// Aggregate weights when a transition has multiple arcs to one place.
    input_totals: Vec<BTreeMap<String, u64>>,
    output_totals: Vec<BTreeMap<String, u64>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    pub inputs: Vec<ScenarioInput>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioInput {
    pub at_ms: Time,
    pub transition: String,
}

#[derive(Debug, Default)]
pub struct Marking {
    pub tokens: BTreeMap<String, u64>,
    pending: BTreeMap<u64, Pending>,
    next_firing: u64,
    last_action: Option<Action>,
}

#[derive(Debug, Serialize)]
struct Pending {
    transition: String,
    started: Time,
    due: Time,
}

#[derive(Debug, Serialize)]
struct Action {
    transition: String,
    phase: &'static str,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
pub struct Step {
    name: String,
    index: usize,
}

impl fmt::Debug for Step {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.name)
    }
}

pub enum Event {
    External(String),
    Complete {
        firing: u64,
        transition: usize,
        name: String,
    },
}

impl fmt::Debug for Event {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::External(name) => write!(f, "input {name}"),
            Self::Complete { name, .. } => write!(f, "complete {name}"),
        }
    }
}

pub(super) fn error(message: impl Into<String>) -> RunError {
    RunError::Semantics(message.into())
}
fn totals(arcs: &[Arc]) -> Result<BTreeMap<String, u64>, RunError> {
    let mut totals = BTreeMap::new();
    for arc in arcs {
        let count = totals.entry(arc.place.clone()).or_insert(0_u64);
        *count = count.checked_add(arc.weight).ok_or_else(|| {
            error(format!(
                "Arc weight exceeds the token range at {}",
                arc.place
            ))
        })?;
    }
    Ok(totals)
}

impl TimedPetri {
    pub fn from_net(net: Net) -> Result<Self, RunError> {
        let mut places = std::collections::BTreeSet::new();
        for place in &net.places {
            if !places.insert(place.id.as_str()) || place.id.is_empty() {
                return Err(error(format!("Duplicate or empty place {}", place.id)));
            }
        }
        let mut ids = std::collections::BTreeSet::new();
        for transition in &net.transitions {
            if transition.id.is_empty() || !ids.insert(transition.id.as_str()) {
                return Err(error(format!(
                    "Duplicate or empty transition {}",
                    transition.id
                )));
            }
            if transition.inputs.is_empty()
                && (!transition.external || transition.outputs.is_empty())
            {
                return Err(error(format!("Missing arcs for {}", transition.name)));
            }
            if transition
                .inputs
                .iter()
                .chain(&transition.outputs)
                .any(|arc| arc.weight == 0 || !places.contains(arc.place.as_str()))
            {
                return Err(error(format!("Invalid arc in {}", transition.name)));
            }
        }
        let transitions = &net.transitions;
        let input_totals = transitions
            .iter()
            .map(|t| totals(&t.inputs))
            .collect::<Result<_, _>>()?;
        let output_totals = transitions
            .iter()
            .map(|t| totals(&t.outputs))
            .collect::<Result<_, _>>()?;
        Ok(Self {
            net,
            input_totals,
            output_totals,
        })
    }
    pub fn net(&self) -> &Net {
        &self.net
    }

    pub fn execute(
        &self,
        profile: &Profile,
        scenario: Scenario,
        model_digest: Option<String>,
    ) -> Result<(RunOutcome<Marking>, Trace), RunError> {
        if profile.language_profile != PROFILE_ID
            || profile.nanos_per_tick != Profile::NANOS_PER_MILLISECOND
        {
            return Err(error(format!("{PROFILE_ID} requires millisecond ticks")));
        }
        let inputs = scenario.inputs.into_iter().map(|input| Input {
            time: input.at_ms,
            event: Event::External(input.transition),
        });
        let language_data = serde_json::to_value(self.net()).map_err(|e| error(e.to_string()))?;
        run_traced(
            self,
            profile,
            inputs,
            TraceMetadata {
                model_digest,
                language_data: Some(language_data),
            },
        )
    }

    fn is_enabled(&self, state: &Marking, index: usize) -> bool {
        self.input_totals[index]
            .iter()
            .all(|(place, weight)| state.tokens.get(place).is_some_and(|count| count >= weight))
    }

    fn add_tokens(&self, state: &mut Marking, index: usize) -> Result<(), RunError> {
        for (place, weight) in &self.output_totals[index] {
            let count = state
                .tokens
                .get_mut(place)
                .ok_or_else(|| error(format!("Unknown place {place}")))?;
            *count = count
                .checked_add(*weight)
                .ok_or_else(|| error(format!("Token count overflow at {place}")))?;
        }
        Ok(())
    }

    fn start(
        &self,
        state: &mut Marking,
        index: usize,
        ctx: &mut StepContext<'_, Event>,
    ) -> Result<(), RunError> {
        let transition = self
            .net
            .transitions
            .get(index)
            .ok_or_else(|| error("Unknown transition"))?;
        for (place, weight) in &self.input_totals[index] {
            let count = state
                .tokens
                .get_mut(place)
                .ok_or_else(|| error(format!("Unknown place {place}")))?;
            *count = count
                .checked_sub(*weight)
                .ok_or_else(|| error(format!("Too few tokens at {place}")))?;
        }
        let phase = if transition.delay_ms == 0 {
            self.add_tokens(state, index)?;
            "fired"
        } else {
            let firing = state.next_firing;
            state.next_firing = firing
                .checked_add(1)
                .ok_or_else(|| error("Firing identity overflow"))?;
            let due = ctx
                .now()
                .checked_add(transition.delay_ms)
                .ok_or(RunError::TimeOverflow {
                    now: ctx.now(),
                    delay: transition.delay_ms,
                })?;
            ctx.schedule_at(
                due,
                -1,
                Event::Complete {
                    firing,
                    transition: index,
                    name: transition.name.clone(),
                },
            )?;
            state.pending.insert(
                firing,
                Pending {
                    transition: transition.id.clone(),
                    started: ctx.now(),
                    due,
                },
            );
            "started"
        };
        state.last_action = Some(Action {
            transition: transition.id.clone(),
            phase,
        });
        Ok(())
    }
}

pub fn profile(policy: Policy, seed: u64, until: Time) -> Profile {
    Profile {
        name: "timed-firing".into(),
        language_profile: PROFILE_ID.into(),
        nanos_per_tick: Profile::NANOS_PER_MILLISECOND,
        policy,
        seed,
        budgets: Budgets {
            steps_per_instant: 1_000,
            total_steps: 100_000,
            events: 100_000,
            end_time: until,
        },
    }
}

impl Semantics for TimedPetri {
    type State = Marking;
    type Step = Step;
    type Event = Event;

    fn initial(&self) -> Result<Marking, RunError> {
        Ok(Marking {
            tokens: self
                .net
                .places
                .iter()
                .map(|place| (place.id.clone(), place.tokens))
                .collect(),
            ..Marking::default()
        })
    }

    fn enabled(&self, state: &Marking, _: Time) -> Result<Vec<Step>, RunError> {
        Ok(self
            .net
            .transitions
            .iter()
            .enumerate()
            .filter(|(i, transition)| !transition.external && self.is_enabled(state, *i))
            .map(|(index, transition)| Step {
                name: transition.name.clone(),
                index,
            })
            .collect())
    }

    fn fire(
        &self,
        state: &mut Marking,
        step: &Step,
        ctx: &mut StepContext<'_, Event>,
    ) -> Result<(), RunError> {
        self.start(state, step.index, ctx)
    }

    fn on_event(
        &self,
        state: &mut Marking,
        event: &Event,
        ctx: &mut StepContext<'_, Event>,
    ) -> Result<EventEffect, RunError> {
        match event {
            Event::External(name) => {
                let mut matches = self
                    .net
                    .transitions
                    .iter()
                    .enumerate()
                    .filter(|(_, t)| t.name == *name);
                let Some((index, transition)) = matches.next() else {
                    return Ok(EventEffect::Rejected("unknown transition".into()));
                };
                if matches.next().is_some() {
                    return Ok(EventEffect::Rejected("ambiguous transition".into()));
                }
                if !transition.external || !self.is_enabled(state, index) {
                    return Ok(EventEffect::Rejected(
                        "external transition is not enabled".into(),
                    ));
                }
                self.start(state, index, ctx)?;
            }
            Event::Complete {
                firing, transition, ..
            } => {
                let pending = state
                    .pending
                    .remove(firing)
                    .ok_or_else(|| error("Unknown pending firing"))?;
                let target = self
                    .net
                    .transitions
                    .get(*transition)
                    .ok_or_else(|| error("Unknown transition"))?;
                if pending.transition != target.id || pending.due != ctx.now() {
                    return Err(error("Completion does not match its pending firing"));
                }
                self.add_tokens(state, *transition)?;
                state.last_action = Some(Action {
                    transition: pending.transition,
                    phase: "completed",
                });
            }
        }
        Ok(EventEffect::Applied)
    }

    fn observe(&self, state: &Marking) -> Result<Value, RunError> {
        Ok(
            json!({ "marking": state.tokens, "pending": state.pending, "action": state.last_action }),
        )
    }
}
