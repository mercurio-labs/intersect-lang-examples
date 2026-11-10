use intersect_model::{
    core::{query::QueryBudget, storage},
    rcore::{DataWire, ExecutionLimits},
};
use serde_json::json;

#[test]
fn sample_validates_and_executes_rcore_behavior() -> Result<(), Box<dyn std::error::Error>> {
    let sources = [examples_library::sample()];
    let (package, model) = examples_library::load(&sources)?;
    model.validate()?;
    assert!(package.evaluate_model_rules(&model)?.diagnostics.is_empty());
    let export = storage::export(&model)?;
    let library = export
        .elements
        .iter()
        .find(|e| e.values.get("name") == Some(&json!("Catalog")))
        .ok_or("Missing sample library")?;
    assert_eq!(library.resource, sources[0].uri);
    let span = sources[0]
        .text
        .get(library.start..library.end)
        .ok_or("Missing catalog source span")?;
    assert!(span.starts_with("library Catalog"));
    let limits = ExecutionLimits::default();
    let count = package.read_derived(
        &model,
        &library.id,
        "copyCount",
        &mut QueryBudget::new(10_000),
        &limits,
    )?;
    assert_eq!(count, json!({"kind": "int64", "value": "2"}));
    let label = package.invoke(&model, &library.id, "inventoryLabel", &[], &limits)?;
    assert!(
        matches!(label.value.data, DataWire::Scalar(value) if value.payload == json!("Catalog inventory"))
    );
    Ok(())
}
