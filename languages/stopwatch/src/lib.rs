//! Rcore owns transitions; Xtext owns commands; Run owns logical time and traces.
use examples_support::{Source, Text};
use intersect_model::{
    api::BasicModel,
    core::storage,
    rcore::{DataWire, ExecutionLimits, RcorePackage, Scalar, ScalarType, ScalarValue},
};
use intersect_run::{
    EventEffect, Input, RunError, Semantics, StepContext, TraceMetadata, run_traced,
};
use serde_json::{Value, json};

pub const RCORE: &str = include_str!("../language/stopwatch.rcore");
pub const SAMPLE: &str = include_str!("../models/demo.watch");
struct Command {
    kind: String,
    delay: u64,
}
pub struct Stopwatch {
    package: RcorePackage,
    model: BasicModel,
    receiver: String,
    commands: Vec<Command>,
}
pub struct State {
    phase: String,
    elapsed: u64,
    since: u64,
    now: u64,
}
pub struct Event {
    index: usize,
    label: String,
}
fn error(e: impl ToString) -> RunError {
    RunError::Semantics(e.to_string())
}
fn string(value: &str) -> DataWire {
    DataWire::Scalar(ScalarValue {
        ty: ScalarType::Scalar(Scalar::String),
        payload: json!(value),
    })
}
impl Stopwatch {
    pub fn load(text: &str) -> Result<Self, String> {
        if text.len() > 65_536 {
            return Err("Script exceeds 64 KiB".into());
        }
        let (package, model) = examples_support::load_rcore_runtime(
            "urn:intersect:example:stopwatch:1",
            Text {
                uri: "stopwatch.rcore",
                content: RCORE,
            },
            Text {
                uri: "stopwatch.xtext",
                content: include_str!("../language/stopwatch.xtext"),
            },
            &[Source {
                uri: "demo.watch".into(),
                text: text.into(),
            }],
            &[("Script", "nextState", "next_state")],
        )?;
        let exported = storage::export(&model)?;
        let root = exported
            .elements
            .iter()
            .find(|e| e.values.contains_key("commands"))
            .ok_or("Missing script")?;
        let ids = root
            .values
            .get("commands")
            .and_then(Value::as_array)
            .ok_or("Missing commands")?;
        if ids.len() > 256 {
            return Err("At most 256 commands are supported".into());
        }
        let mut commands = Vec::new();
        let mut total = 0_u64;
        for id in ids {
            let command = exported
                .elements
                .iter()
                .find(|e| Some(e.id.as_str()) == id.as_str())
                .ok_or("Missing command")?;
            let kind = command
                .values
                .get("kind")
                .and_then(Value::as_str)
                .ok_or("Missing command kind")?
                .to_owned();
            let delay = if kind == "wait" {
                let amount = command
                    .values
                    .get("amount")
                    .and_then(|v| {
                        v.as_u64().or_else(|| {
                            v.get("value")
                                .and_then(Value::as_str)
                                .and_then(|s| s.parse().ok())
                        })
                    })
                    .ok_or("Invalid wait duration")?;
                let scale = match command.values.get("unit").and_then(Value::as_str) {
                    Some("s") => 1000,
                    Some("ms") => 1,
                    _ => return Err("Invalid time unit".into()),
                };
                amount.checked_mul(scale).ok_or("Wait overflow")?
            } else {
                0
            };
            total = total.checked_add(delay).ok_or("Timeline overflow")?;
            if total > 3_600_000 {
                return Err("Timeline exceeds one hour".into());
            }
            commands.push(Command { kind, delay });
        }
        Ok(Self {
            package,
            model,
            receiver: root.id.clone(),
            commands,
        })
    }
    fn event(&self, index: usize) -> Event {
        Event {
            index,
            label: self.commands.get(index).map_or_else(
                || "end".into(),
                |c| {
                    if c.kind == "wait" {
                        format!("wait {}ms", c.delay)
                    } else {
                        c.kind.clone()
                    }
                },
            ),
        }
    }
    pub fn execute(&self) -> Result<Value, String> {
        let settings = profile();
        let mut transitions = Vec::new();
        for from in ["idle", "running", "stopped"] {
            for command in ["start", "wait", "stop"] {
                let result = self
                    .package
                    .invoke(
                        &self.model,
                        &self.receiver,
                        "nextState",
                        &[string(from), string(command)],
                        &ExecutionLimits::default(),
                    )
                    .map_err(|e| e.to_string())?;
                if let DataWire::Scalar(value) = result.value.data {
                    if value.payload != "invalid" {
                        transitions.push(json!({"from":from,"command":command,"to":value.payload}));
                    }
                }
            }
        }
        let (outcome, trace) = run_traced(
            self,
            &settings,
            [Input {
                time: 0,
                event: self.event(0),
            }],
            TraceMetadata {
                model_digest: None,
                language_data: Some(json!({"kind":"stopwatch"})),
            },
        )
        .map_err(|e| e.to_string())?;
        Ok(
            json!({"machine":{"states":["idle","running","stopped"],"transitions":transitions},"trace":trace,"summary":self.observe(&outcome.state).map_err(|e|e.to_string())?,"reason":format!("{:?}",outcome.reason)}),
        )
    }
}
fn profile() -> intersect_run::Profile {
    intersect_run::Profile {
        name: "stopwatch".into(),
        language_profile: "stopwatch.v1".into(),
        nanos_per_tick: 1_000_000,
        policy: intersect_run::Policy::First,
        seed: 0,
        budgets: intersect_run::Budgets {
            steps_per_instant: 1000,
            total_steps: 1000,
            events: 1000,
            end_time: 3_600_000,
        },
    }
}
impl Semantics for Stopwatch {
    type State = State;
    type Step = usize;
    type Event = Event;
    fn initial(&self) -> Result<State, RunError> {
        Ok(State {
            phase: "idle".into(),
            elapsed: 0,
            since: 0,
            now: 0,
        })
    }
    fn enabled(&self, _: &State, _: u64) -> Result<Vec<usize>, RunError> {
        Ok(vec![])
    }
    fn fire(
        &self,
        _: &mut State,
        _: &usize,
        _: &mut StepContext<'_, Event>,
    ) -> Result<(), RunError> {
        Err(error("Stopwatch uses command events"))
    }
    fn on_event(
        &self,
        state: &mut State,
        event: &Event,
        ctx: &mut StepContext<'_, Event>,
    ) -> Result<EventEffect, RunError> {
        state.now = ctx.now();
        let Some(command) = self.commands.get(event.index) else {
            return Ok(EventEffect::Applied);
        };
        let next = self
            .package
            .invoke(
                &self.model,
                &self.receiver,
                "nextState",
                &[string(&state.phase), string(&command.kind)],
                &ExecutionLimits::default(),
            )
            .map_err(error)?;
        let DataWire::Scalar(value) = next.value.data else {
            return Err(error("Transition must return a string"));
        };
        let next = value
            .payload
            .as_str()
            .ok_or_else(|| error("Transition must return a state"))?;
        // Schedule even a rejected command's successor, retaining its rejection
        // in the trace. Waiting advances Run's queue rather than a host clock.
        ctx.schedule_after(command.delay, 0, self.event(event.index + 1))?;
        if next == "invalid" {
            return Ok(EventEffect::Rejected(format!(
                "{} is invalid in {}",
                command.kind, state.phase
            )));
        }
        if state.phase == "running" && next != "running" {
            state.elapsed = state
                .elapsed
                .checked_add(state.now - state.since)
                .ok_or_else(|| error("Elapsed time overflow"))?;
        }
        if state.phase != "running" && next == "running" {
            state.since = state.now;
        }
        state.phase = next.into();
        Ok(EventEffect::Applied)
    }
    fn observe(&self, state: &State) -> Result<Value, RunError> {
        let elapsed = state.elapsed
            + if state.phase == "running" {
                state.now - state.since
            } else {
                0
            };
        Ok(json!({"state":state.phase,"elapsed_ms":elapsed,"time_ms":state.now}))
    }
}

impl std::fmt::Debug for Event {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.label)
    }
}

pub fn run(text: &str) -> Result<Value, String> {
    Stopwatch::load(text)?.execute()
}
