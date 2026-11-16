//! Task: regenerate a pack after editing the source files listed in project.json.
use intersect_toolkit_runner::build_project;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let model = build_project(folder.join("project.json"), folder.join("rebuilt.pack"))?;
    println!("Built rebuilt.pack\n{}", model.summary());
    Ok(())
}
