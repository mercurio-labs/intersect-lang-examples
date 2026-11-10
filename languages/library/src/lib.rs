//! Handwritten registration of the authored Library definitions.
use examples_support::{Source, Text, load_rcore_text};
use intersect_model::{
    api::BasicModel, compile_rcore_at, core::storage::MemoryStore, rcore::RcorePackage,
};

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
    let (text_schema, mut parsed) = load_rcore_text(
        "urn:intersect:example:library:1",
        STRUCTURE,
        Text {
            uri: "library.xtext",
            content: include_str!("../language/library.xtext"),
        },
        sources,
    )?;
    let mut package =
        compile_rcore_at(STRUCTURE.uri, STRUCTURE.content).map_err(|error| error.to_string())?;
    let runtime = package.schema();
    // Text compilation uses its own class keys. Select the runtime class by
    // the exact authored declaration, retaining every object and source span.
    for element in &mut parsed.elements {
        let declaration = text_schema
            .declarations
            .get(&element.class)
            .ok_or_else(|| format!("Missing text declaration for {}", element.class))?;
        let key = runtime.class_key(
            &declaration.source,
            &declaration.namespace,
            &declaration.name,
        )?;
        if runtime.declarations.get(key) != Some(declaration) || !runtime.classes.contains_key(key)
        {
            return Err(format!("Runtime declaration differs for {}", element.class));
        }
        element.class = key.into();
        element.type_identity = runtime.identity(key);
    }
    parsed.schema_revision.clone_from(&runtime.revision);
    let model = BasicModel::from_store(runtime.clone(), MemoryStore::from_model(&parsed)?)?;
    model.validate()?;
    package
        .bind_operation("Library", "inventoryLabel", "inventory_label")
        .map_err(|error| error.to_string())?;
    Ok((package, model))
}
