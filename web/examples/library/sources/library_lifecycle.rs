//! Handwritten walkthrough: load text -> validate -> inspect -> read a derived
//! feature -> invoke an operation -> save/reload the model and its definitions.
use intersect_model::{
    core::{query::QueryBudget, storage},
    rcore::{DataWire, ExecutionLimits, RcorePackage},
};
use serde_json::json;
use std::{fs, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = Path::new("target/runs/library-lifecycle");
    fs::create_dir_all(output)?;

    // 1. Load the grammar and authored Rcore structure, parse and check the
    // sample, preserve source identities, and bind the inventoryLabel operation.
    let sources = [examples_library::sample()];
    let (package, model) = examples_library::load(&sources)?;

    // 2. Structural validation and semantic rule evaluation are separate.
    model.validate()?;
    let rules = package.evaluate_model_rules(&model)?;
    if !rules.diagnostics.is_empty() {
        return Err(format!("Library rule diagnostics: {:?}", rules.diagnostics).into());
    }

    // 3. Export a model view for inspection and locate the receiver by name.
    // Runtime calls use its exact identity; its span still selects source text.
    let exported = storage::export(&model)?;
    let library = exported
        .elements
        .iter()
        .find(|element| element.values.get("name") == Some(&json!("Catalog")))
        .ok_or("Missing Catalog library")?;
    let span = sources[0]
        .text
        .get(library.start..library.end)
        .ok_or("Library source span is outside the source text")?;
    println!("{} in {}: {span}", library.id, library.resource);

    // 4. Execute the authored derived getter and operation under explicit
    // budgets. These use the shared Rcore evaluator, not handwritten behavior.
    let limits = ExecutionLimits::default();
    let count = package.read_derived(
        &model,
        &library.id,
        "copyCount",
        &mut QueryBudget::new(10_000),
        &limits,
    )?;
    let label = package.invoke(&model, &library.id, "inventoryLabel", &[], &limits)?;
    if count != json!({"kind": "int64", "value": "2"})
        || !matches!(&label.value.data, DataWire::Scalar(value) if value.payload == json!("Catalog inventory"))
    {
        return Err("Unexpected sample derived feature or operation result".into());
    }
    println!("copyCount = 2; inventoryLabel() = Catalog inventory");

    // 5. Save the model with exact definitions and explicit operation bindings.
    // Reload recompiles verified sources and validates the restored model.
    let path = output.join("library.model.json");
    fs::write(&path, package.save(&model)?)?;
    let (restored_package, restored_model) = RcorePackage::reload(&fs::read(&path)?)?;
    let restored_count = restored_package.read_derived(
        &restored_model,
        &library.id,
        "copyCount",
        &mut QueryBudget::new(10_000),
        &limits,
    )?;
    let restored_label =
        restored_package.invoke(&restored_model, &library.id, "inventoryLabel", &[], &limits)?;
    if restored_count != count || restored_label.value != label.value {
        return Err("Reload changed derived or operation behavior".into());
    }
    let restored_export = storage::export(&*restored_model)?;
    if serde_json::to_value(&restored_export)? != serde_json::to_value(&exported)? {
        return Err("Reload changed the model, source identities or spans".into());
    }
    println!(
        "Model and Rcore behavior survived the round trip: {}",
        path.display()
    );
    Ok(())
}
