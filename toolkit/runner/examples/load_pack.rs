//! Task: load an existing compiled model and use its objects in your application.
use intersect_toolkit_runner::load_pack;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let model = load_pack(folder.join("model.pack"))?;
    println!("{}", model.summary());
    for object in &model.evaluation.model.elements {
        println!("{}: {}", object.id, object.class);
    }
    model.write_result(folder.join("output/model.json"))?;
    Ok(())
}
