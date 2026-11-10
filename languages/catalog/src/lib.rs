//! Handwritten catalog definition registration. Text loading is shared.
use examples_support::{Language, Loaded, Source, Text};

pub const LANGUAGE: Language<'static> = Language {
    namespace: "urn:intersect:example:catalog:1",
    ecore: Text {
        uri: "catalog.ecore",
        content: include_str!("../language/catalog.ecore"),
    },
    grammar: Text {
        uri: "catalog.xtext",
        content: include_str!("../language/catalog.xtext"),
    },
    bindings: Text {
        uri: "catalog-scoping.rcore",
        content: include_str!("../language/catalog-scoping.rcore"),
    },
};

pub fn load_sample() -> Result<Loaded, String> {
    examples_support::load(
        &LANGUAGE,
        &[
            Source {
                uri: "types.catalog".into(),
                text: include_str!("../models/types.catalog").into(),
            },
            Source {
                uri: "shop.catalog".into(),
                text: include_str!("../models/shop.catalog").into(),
            },
        ],
    )
}
