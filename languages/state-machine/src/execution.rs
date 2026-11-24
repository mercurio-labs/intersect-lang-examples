//! Language-specific transition selection over an immutable, checked model.
use crate::PROFILE;
use intersect_model::core::frozen::{Model, Obj};
use intersect_run::{
    EventEffect, Input, Profile, RunError, Semantics, StepContext, Trace, TraceKind, TraceMetadata,
    run_traced,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

const MAX_STATES: usize = 64;
const MAX_DEPTH: usize = 4;
const MAX_EVENTS: usize = 64;
const MAX_TRANSITIONS: usize = 256;
const MAX_INPUTS: usize = 256;

pub(super) struct Machine {
    pub name: String,
    pub events: Vec<String>,
    digest: String,
    initial: String,
    states: BTreeMap<String, State>,
    transitions: BTreeMap<(String, String), Transition>,
}

struct State {
    name: String,
    parent: Option<String>,
    initial: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Transition {
    id: String,
    source: String,
    event: String,
    target: String,
}

#[derive(Serialize)]
pub struct Run {
    pub trace: Trace,
    pub frames: Vec<Frame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub tick: u64,
    pub event: Option<String>,
    pub outcome: &'static str,
    pub active: Vec<ActiveState>,
    pub transition: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ActiveState {
    pub id: String,
    pub name: String,
}

#[derive(Default)]
pub(super) struct Execution {
    active: Vec<String>,
    pending: Option<Transition>,
    last_transition: Option<String>,
}

pub(super) struct Event(String);

impl fmt::Debug for Event {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.0)
    }
}

fn refs<'a>(object: Obj<'a>, name: &str) -> Result<impl Iterator<Item = Obj<'a>> + 'a, String> {
    let feature = object
        .feature(name)
        .ok_or_else(|| format!("Model is missing feature {name}"))?;
    Ok(object.refs(feature))
}

fn one<'a>(object: Obj<'a>, field: &str) -> Result<Obj<'a>, String> {
    refs(object, field)?
        .next()
        .ok_or_else(|| format!("Missing {field} reference"))
}

fn name(object: Obj<'_>) -> Result<&str, String> {
    object
        .feature("name")
        .and_then(|feature| object.str(feature))
        .ok_or("Missing name".into())
}

impl Machine {
    pub fn from_model(model: &Model, digest: String) -> Result<Self, String> {
        let mut roots = model
            .objects()
            .filter(|object| object.container().is_none());
        let machine = roots.next().ok_or("Declare one machine")?;
        if roots.next().is_some() {
            return Err("The harness accepts exactly one machine".into());
        }
        let mut states = BTreeMap::new();
        let mut names = BTreeSet::new();
        for state in refs(machine, "states")? {
            Self::add_state(&mut states, &mut names, state, None, 1)?;
        }
        let mut known_events = BTreeSet::new();
        let mut events = Vec::new();
        for event in refs(machine, "events")? {
            let event = name(event)?.to_owned();
            if event.len() > 128 {
                return Err("Event names may contain at most 128 bytes".into());
            }
            if events.len() == MAX_EVENTS {
                return Err("A machine can declare at most 64 events".into());
            }
            if !known_events.insert(event.clone()) {
                return Err(format!("Duplicate event {event}"));
            }
            events.push(event);
        }
        let mut transitions = BTreeMap::new();
        for node in refs(machine, "transitions")? {
            if transitions.len() == MAX_TRANSITIONS {
                return Err("A machine can declare at most 256 transitions".into());
            }
            let source = one(node, "source")?;
            let event = name(one(node, "event")?)?;
            let target = one(node, "target")?;
            let transition = Transition {
                id: node.identity().into(),
                source: source.identity().into(),
                event: event.into(),
                target: target.identity().into(),
            };
            if transitions
                .insert((transition.source.clone(), event.into()), transition)
                .is_some()
            {
                return Err(format!(
                    "State {} has multiple transitions on {event}",
                    name(source)?
                ));
            }
        }
        Ok(Self {
            name: name(machine)?.into(),
            initial: one(machine, "initial")?.identity().into(),
            events,
            digest,
            states,
            transitions,
        })
    }

    fn add_state(
        states: &mut BTreeMap<String, State>,
        names: &mut BTreeSet<String>,
        object: Obj<'_>,
        parent: Option<&str>,
        depth: usize,
    ) -> Result<(), String> {
        if depth > MAX_DEPTH {
            return Err("States may nest up to four levels".into());
        }
        if states.len() == MAX_STATES {
            return Err("A machine can declare at most 64 states".into());
        }
        let name = name(object)?;
        if !names.insert(name.into()) {
            return Err(format!("Duplicate state {name}"));
        }
        let children = refs(object, "states")?.collect::<Vec<_>>();
        let initial = refs(object, "initial")?.next().map(Obj::identity);
        if !children.is_empty() && initial.is_none() {
            return Err(format!("Composite state {name} requires an initial child"));
        }
        states.insert(
            object.identity().into(),
            State {
                name: name.into(),
                parent: parent.map(str::to_owned),
                initial: initial.map(str::to_owned),
            },
        );
        for child in children {
            Self::add_state(states, names, child, Some(object.identity()), depth + 1)?;
        }
        Ok(())
    }

    fn enter(&self, target: &str) -> Result<Vec<String>, RunError> {
        let state = |id: &str| {
            self.states
                .get(id)
                .ok_or_else(|| RunError::Semantics("Missing checked state".into()))
        };
        let mut path = vec![target.to_owned()];
        let mut parent = state(target)?.parent.as_deref();
        while let Some(id) = parent {
            path.push(id.to_owned());
            parent = state(id)?.parent.as_deref();
        }
        path.reverse();
        let mut child = state(target)?.initial.as_deref();
        while let Some(id) = child {
            path.push(id.to_owned());
            child = state(id)?.initial.as_deref();
        }
        Ok(path)
    }

    pub fn run(&self, events: &[String]) -> Result<Run, String> {
        if events.len() > MAX_INPUTS || events.iter().any(|name| name.len() > 128) {
            return Err("Use at most 256 inputs of at most 128 bytes each".into());
        }
        let profile: Profile = serde_json::from_str(PROFILE).map_err(|error| error.to_string())?;
        let inputs = events.iter().enumerate().map(|(index, event)| Input {
            time: index as u64 + 1,
            event: Event(event.clone()),
        });
        let (_, trace) = run_traced(
            self,
            &profile,
            inputs,
            TraceMetadata {
                model_digest: Some(self.digest.clone()),
                language_data: Some(json!({"machine":self.name,"inputs":events})),
            },
        )
        .map_err(|error| error.to_string())?;
        let mut frames = Vec::with_capacity(events.len() + 1);
        for entry in &trace.entries {
            let outcome = match entry.kind {
                TraceKind::RunStart => "initial",
                TraceKind::StepFired => "transition",
                TraceKind::InputRejected => "rejected",
                _ => continue,
            };
            let observation = entry
                .observation
                .as_ref()
                .ok_or("Missing run observation")?;
            frames.push(Frame {
                tick: entry.time,
                event: entry
                    .time
                    .checked_sub(1)
                    .and_then(|index| events.get(index as usize))
                    .cloned(),
                outcome,
                active: serde_json::from_value(observation["active"].clone())
                    .map_err(|error| error.to_string())?,
                transition: observation["transition"].as_str().map(str::to_owned),
                message: (entry.kind == TraceKind::InputRejected).then(|| entry.label.clone()),
            });
        }
        if frames.len() != events.len() + 1 {
            return Err("Run stopped before processing the entire scenario".into());
        }
        Ok(Run { trace, frames })
    }
}

impl Semantics for Machine {
    type State = Execution;
    type Step = Transition;
    type Event = Event;

    fn initial(&self) -> Result<Execution, RunError> {
        Ok(Execution {
            active: self.enter(&self.initial)?,
            ..Execution::default()
        })
    }

    fn enabled(&self, state: &Execution, _: u64) -> Result<Vec<Transition>, RunError> {
        Ok(state.pending.iter().cloned().collect())
    }

    fn fire(
        &self,
        state: &mut Execution,
        step: &Transition,
        _: &mut StepContext<'_, Event>,
    ) -> Result<(), RunError> {
        state.active = self.enter(&step.target)?;
        state.last_transition = Some(step.id.clone());
        state.pending = None;
        Ok(())
    }

    fn on_event(
        &self,
        state: &mut Execution,
        event: &Event,
        _: &mut StepContext<'_, Event>,
    ) -> Result<EventEffect, RunError> {
        state.last_transition = None;
        if !self.events.contains(&event.0) {
            return Ok(EventEffect::Rejected("event is undeclared".into()));
        }
        state.pending = state.active.iter().rev().find_map(|id| {
            self.transitions
                .get(&(id.clone(), event.0.clone()))
                .cloned()
        });
        Ok(if state.pending.is_some() {
            EventEffect::Applied
        } else {
            EventEffect::Rejected("no transition from an active state".into())
        })
    }

    fn observe(&self, state: &Execution) -> Result<Value, RunError> {
        let active = state
            .active
            .iter()
            .map(|id| {
                self.states
                    .get(id)
                    .map(|active| json!({"id":id,"name":active.name}))
                    .ok_or_else(|| RunError::Semantics("Missing active state".into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(json!({"active":active,"transition":state.last_transition}))
    }
}
