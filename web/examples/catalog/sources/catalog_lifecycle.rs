//! Handwritten walkthrough: prepare -> parse two resources -> link -> validate
//! -> inspect references -> save and restore a compiled language pack.
use examples_support::Loaded;
use intersect_model::core::frozen::Obj;
use std::{collections::BTreeSet, fs, path::Path};

fn qualified(object: Obj<'_>) -> String {
    let mut current = Some(object);
    let mut names = Vec::new();
    while let Some(object) = current {
        if let Some(name) = object.feature("name").and_then(|id| object.str(id)) {
            names.push(name);
        }
        current = object.container().map(|(owner, _)| owner);
    }
    names.reverse();
    names.join(".")
}

fn references(loaded: &Loaded) -> Result<BTreeSet<(String, String, String)>, String> {
    if loaded.has_errors() {
        return Err(format!(
            "Catalog validation failed: {:?}",
            loaded.diagnostics
        ));
    }
    let mut references = BTreeSet::new();
    for object in loaded.model.objects() {
        for feature in ["type", "superType"] {
            if let Some(id) = object.feature(feature) {
                for target in object.refs(id) {
                    // Source identities, rather than display names, make the
                    // equality check sensitive to cross-resource targets.
                    references.insert((
                        object.identity().to_owned(),
                        feature.to_owned(),
                        target.identity().to_owned(),
                    ));
                    println!("  {}.{feature} -> {}", qualified(object), qualified(target));
                }
            }
        }
    }
    Ok(references)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = Path::new("target/runs/catalog-lifecycle");
    fs::create_dir_all(output)?;

    // 1. Keep both resources in one load so the declared Rcore scopes can
    // resolve local, enclosing-package, imported and fully qualified names.
    let sources = examples_catalog::sample_sources();

    // 2. Preparation migrates the retained Ecore definitions to Rcore, compiles
    // the grammar and scopes, parses both sources, links and checks structure.
    let loaded = examples_support::load(&examples_catalog::LANGUAGE, &sources)?;
    println!(
        "{} resources, {} checked objects",
        sources.len(),
        loaded.model.objects().len()
    );

    // 3. Inspect the resolved model through frozen-engine reflection.
    let before = references(&loaded)?;
    if before.len() != 9 {
        return Err("Expected all nine sample reference targets".into());
    }

    // 4. Persist compiled definitions separately from model sources. Restore
    // only packs built by this host; the digest is not publisher authentication.
    let path = output.join("catalog.pack");
    fs::write(
        &path,
        examples_support::build_pack(&examples_catalog::LANGUAGE)?,
    )?;
    let restored =
        examples_support::load_pack(&examples_catalog::LANGUAGE, fs::read(&path)?, &sources)?;

    // 5. Reparse/link the sources with the restored definition. A pack must
    // preserve every reference's source and target identity, not just counts.
    let after = references(&restored)?;
    if before != after {
        return Err("Restoring the language pack changed reference identities".into());
    }
    println!(
        "All nine reference targets survived the round trip: {}",
        path.display()
    );
    Ok(())
}
