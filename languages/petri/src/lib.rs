//! Handwritten definition registration. Parsing and linking are generic.
mod semantics;

pub use semantics::{
    Arc, DEFAULT_END_TIME, Event, Marking, Net, PROFILE_ID, Place, Scenario, ScenarioInput, Step,
    TimedPetri, Transition, profile,
};

use examples_support::{Language, Loaded, Source, Text};

const LANGUAGE: Language<'static> = Language {
    namespace: "urn:intersect:example:petri:1",
    ecore: Text {
        uri: "petri.ecore",
        content: include_str!("../language/petri.ecore"),
    },
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
