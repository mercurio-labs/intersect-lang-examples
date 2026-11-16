//! Tasks: load a saved model, inspect a pack, unpack sources, rebuild a pack.
//! For application code rather than a CLI, start with examples/load_pack.rs.
use intersect_toolkit_runner::{build_project, inspect_pack, load_pack, unpack_pack};
use std::path::PathBuf;

const HELP: &str = "Work with Intersect models and source files.

  load    [model.pack]                 Load, validate and evaluate a saved model
  inspect [model.pack]                 Show its language, recipe and sections
  unpack  <existing.pack> <folder>     Extract editable sources into an empty folder
  build   [project.json] [new.pack]    Compile edited sources into a new pack

Examples (after cargo run --release --locked --):
  load model.pack
  inspect model.pack
  unpack existing.pack editable
  build editable/project.json rebuilt.pack
  load rebuilt.pack

No arguments: load the included model.pack. Results go to output/model.json.
";

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("load");
    let path = |index, default: &str| {
        args.get(index)
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(default))
    };
    let maximum = match command {
        "load" | "inspect" => 2,
        "build" | "unpack" => 3,
        _ => 1,
    };
    if args.len() > maximum {
        return Err("Too many arguments. Run with --help for examples.".into());
    }
    match command {
        "--help" | "-h" | "help" => print!("{HELP}"),
        "load" => {
            let file = path(1, "model.pack");
            let model = load_pack(&file)?;
            model.write_result(root.join("output/model.json"))?;
            println!(
                "Loaded {}\n{}\nResult: {}",
                file.display(),
                model.summary(),
                root.join("output/model.json").display()
            );
        }
        "inspect" => print!("{}", inspect_pack(path(1, "model.pack"))?),
        "unpack" => {
            if args.len() != 3 {
                return Err("Usage: unpack <existing.pack> <empty-folder>".into());
            }
            unpack_pack(&args[1], &args[2])?;
            println!(
                "Editable sources: {}/project.json\nEdit those files, then run build.",
                args[2]
            );
        }
        "build" => {
            let project = path(1, "project.json");
            let output = path(2, "rebuilt.pack");
            let model = build_project(&project, &output)?;
            println!(
                "Built {} from {}\n{}",
                output.display(),
                project.display(),
                model.summary()
            );
        }
        pack if pack.ends_with(".pack") => {
            let model = load_pack(pack)?;
            model.write_result(root.join("output/model.json"))?;
            println!("{}", model.summary());
        }
        _ => {
            return Err(
                format!("Unknown command: {command}. Run with --help for examples.").into(),
            );
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
