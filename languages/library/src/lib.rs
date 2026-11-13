//! Handwritten registration of the authored Library definitions.
use examples_support::{Source, Text};
use intersect_model::{api::BasicModel, rcore::RcorePackage};

const STRUCTURE: Text<'static> = Text {
    uri: "library.rcore",
    content: include_str!("../language/library.rcore"),
};

pub fn sample() -> Source {
    Source {
        uri: "catalog.library".into(),
        text: include_str!("../models/catalog.library").into(),
    }
}

pub fn load(sources: &[Source]) -> Result<(RcorePackage, BasicModel), String> {
    examples_support::load_rcore_runtime(
        "urn:intersect:example:library:1",
        STRUCTURE,
        Text {
            uri: "library.xtext",
            content: include_str!("../language/library.xtext"),
        },
        sources,
        &[("Library", "inventoryLabel", "inventory_label")],
    )
}
