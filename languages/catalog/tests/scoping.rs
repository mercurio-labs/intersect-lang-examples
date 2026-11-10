use intersect_model::core::frozen::Obj;
use std::collections::BTreeSet;

fn qualified(object: Obj<'_>) -> String {
    let mut current = Some(object);
    let mut parts = Vec::new();
    while let Some(object) = current {
        if let Some(name) = object
            .feature("name")
            .and_then(|feature| object.str(feature))
        {
            parts.push(name);
        }
        current = object.container().map(|(owner, _)| owner);
    }
    parts.reverse();
    parts.join(".")
}

#[test]
fn resolves_all_nine_references_and_validates() -> Result<(), String> {
    assert_reference_targets(examples_catalog::load_sample()?);
    Ok(())
}

#[test]
fn pack_restores_all_nine_reference_targets() -> Result<(), String> {
    let language = &examples_catalog::LANGUAGE;
    let pack = examples_support::build_pack(language)?;
    let loaded = examples_support::load_pack(language, pack, &examples_catalog::sample_sources())?;
    assert_reference_targets(loaded);
    Ok(())
}

fn assert_reference_targets(loaded: examples_support::Loaded) {
    assert!(loaded.diagnostics.is_empty());
    let mut actual = BTreeSet::new();
    for object in loaded.model.objects() {
        for feature in ["type", "superType"] {
            if let Some(id) = object.feature(feature) {
                for target in object.refs(id) {
                    assert!(actual.insert((qualified(object), feature, qualified(target))));
                }
            }
        }
    }
    let expected = [
        ("base.Named.name", "type", "base.types.String"),
        ("shop.Customer", "superType", "base.Named"),
        ("shop.Customer.age", "type", "base.types.Int"),
        ("shop.Customer.orders", "type", "shop.Order"),
        ("shop.Order.customer", "type", "shop.Customer"),
        ("shop.Order.total", "type", "base.types.Int"),
        ("shop.billing.Invoice", "superType", "shop.Order"),
        ("shop.billing.Invoice.number", "type", "base.types.String"),
        ("shop.billing.Invoice.buyer", "type", "shop.Customer"),
    ]
    .map(|(owner, feature, target)| (owner.to_owned(), feature, target.to_owned()));
    assert_eq!(actual, BTreeSet::from(expected));
}
