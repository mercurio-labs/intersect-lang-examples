//! Checked model, Intersect Views projection, and shared native/WASM run profile.
mod execution;
#[cfg(target_arch = "wasm32")]
mod wasm;

use execution::Machine;
pub use execution::{Frame, Run};
use intersect_model::definitions::bundle::{DefinitionSource, SourceKind};
use intersect_view_host::{Host, LanguageDefinition, NoCommands};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const SAMPLE: &str = include_str!("../models/airlock.machine");
pub const SCENARIO: &str = include_str!("../models/airlock.events.json");
pub const PROFILE: &str = include_str!("../profiles/event-step.json");
pub const NOTATION: &str = include_str!("../views/machine.notation.json");
const NAMESPACE: &str = "urn:intersect:example:state-machine:1";
const MAX_SOURCE: usize = 65_536;

fn definition() -> LanguageDefinition {
    let structure = DefinitionSource::new(
        "machine.rcore",
        SourceKind::Rcore,
        include_str!("../language/machine.rcore"),
    );
    let grammar = DefinitionSource::new(
        "machine.xtext",
        SourceKind::Xtext,
        include_str!("../language/machine.xtext"),
    );
    let behavior = |uri, text| {
        let mut source = DefinitionSource::new(uri, SourceKind::RcoreBehavior, text);
        source.dependencies.push(structure.id.clone());
        source
    };
    let bindings = behavior("bindings.rcore", include_str!("../language/bindings.rcore"));
    let views = behavior("views.rcore", include_str!("../language/views.rcore"));
    LanguageDefinition {
        id: "state-machine".into(),
        name: "State machine".into(),
        namespace: NAMESPACE.into(),
        file_extensions: vec!["machine".into()],
        structure,
        grammar,
        bindings,
        view_functions: vec![views],
        extra_functions: vec![],
        view_execution_limits: Default::default(),
        view_function_work: 2_000_000,
        rule_sets: vec![include_str!("../views/machine.viewrules.json").into()],
        notation: NOTATION.into(),
        palette: include_str!("../views/machine.palette.json").into(),
        name_features: vec!["name".into()],
    }
}

pub struct Harness {
    host: Host,
    machine: Option<Machine>,
    revision: u64,
}

impl Harness {
    pub fn new() -> Result<Self, String> {
        let mut host = Host::new(definition(), Box::new(NoCommands))?;
        host.dispatch(json!({"method":"initialize","params":{"protocolVersion":2}}))?;
        Ok(Self {
            host,
            machine: None,
            revision: 0,
        })
    }

    /// A failed compile revokes execution until the current source is fixed.
    pub fn load(&mut self, source: &str) -> Result<Value, String> {
        self.machine = None;
        if source.len() > MAX_SOURCE {
            return Err("Machine source exceeds 64 KiB".into());
        }
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or("Revision limit exceeded")?;
        let revision = self.revision;
        let analysis = self.host.dispatch(json!({
            "method":"workspace/analyze","params":{"revision":revision,"sources":[
                {"uri":"model.machine","text":source},
                {"uri":"machine.view.json","text":include_str!("../views/machine.view.json")}
            ]}
        }))?;
        if analysis["clean"] != true {
            let diagnostics = analysis.get("diagnostics").unwrap_or(&Value::Null);
            return Err(format!("Machine analysis failed: {diagnostics}"));
        }
        let model = self
            .host
            .accepted_model()
            .ok_or("Missing accepted machine model")?;
        let machine = Machine::from_model(model, format!("{:x}", Sha256::digest(source)))?;
        let catalog = self.host.view_catalog(revision)?;
        let view = catalog
            .views
            .first()
            .ok_or("Missing state transition view")?;
        let root = view
            .owners
            .iter()
            .find(|owner| owner.label == machine.name)
            .ok_or("Missing machine in the view catalog")?;
        let scene = self.host.dispatch(json!({"method":"views/scene","params":{
            "revision":revision,"viewKey":view.key,
            "scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":root.key}]}
        }}))?;
        let initial = machine.run(&[])?;
        let response = json!({
            "name": machine.name, "events": machine.events, "scene": scene,
            "notation": serde_json::from_str::<Value>(NOTATION).map_err(|error| error.to_string())?,
            "initial": initial.frames.first().ok_or("Missing run start")?,
        });
        self.machine = Some(machine);
        Ok(response)
    }

    pub fn run(&self, events: &[String]) -> Result<Run, String> {
        self.machine
            .as_ref()
            .ok_or("Load a checked machine first")?
            .run(events)
    }

    pub fn dispatch(&mut self, request: Value) -> Result<Value, String> {
        match request["method"].as_str() {
            Some("machine/load") => self.load(
                request["params"]["source"]
                    .as_str()
                    .ok_or("Missing source")?,
            ),
            Some("machine/run") => {
                let events =
                    serde_json::from_value::<Vec<String>>(request["params"]["events"].clone())
                        .map_err(|error| error.to_string())?;
                serde_json::to_value(self.run(&events)?).map_err(|error| error.to_string())
            }
            _ => Err("Unknown state machine request".into()),
        }
    }
}
