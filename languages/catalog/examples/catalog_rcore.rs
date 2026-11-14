//! Export the Rcore migration used by Catalog for the example gallery.
use intersect_model::{
    definitions::bundle::{DefinitionSource, SourceKind},
    migration::migrate_ecore,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let report = migrate_ecore(
        DefinitionSource::new(
            "catalog.ecore",
            SourceKind::Ecore,
            include_str!("../language/catalog.ecore"),
        ),
        "catalog.rcore",
    )?;
    let converted = report.converted.ok_or("Catalog migration is incomplete")?;
    print!("{}", converted.text);
    Ok(())
}
