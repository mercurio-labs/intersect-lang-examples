//! Handwritten definition registration. Parsing and linking are generic.
mod engine;
mod semantics;

pub use engine::{
    Arc, Event, Marking, Net, PROFILE_ID, Place, Scenario, ScenarioInput, Step, TimedPetri,
    Transition, profile,
};

pub const DEFAULT_END_TIME: intersect_run::Time = 20_000;

use examples_support::{Language, Loaded, Source, Structure, Text};

pub const LANGUAGE: Language<'static> = Language {
    namespace: "urn:intersect:example:petri:1",
    structure: Structure::Rcore(Text {
        uri: "petri.rcore",
        content: include_str!("../language/petri.rcore"),
    }),
    grammar: Text {
        uri: "petri.xtext",
        content: include_str!("../language/petri.xtext"),
    },
    bindings: Text {
        uri: "petri-bindings.rcore",
        content: include_str!("../language/petri-bindings.rcore"),
    },
};

pub fn load(sources: &[Source]) -> Result<Loaded, String> {
    examples_support::load(&LANGUAGE, sources)
}
