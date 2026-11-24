use rcore_engine_feasibility::pack::{self, Archive, RunRequest};
use std::{
    env,
    fs::{self, File},
    io::{self, Read},
    path::Path,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const USAGE: &str = "Usage: rcore-engine-feasibility pack LANGUAGE.toml ARCHIVE.json\n\
                    rcore-engine-feasibility inspect ARCHIVE.json\n\
                    rcore-engine-feasibility [check|run] ARCHIVE.json REQUEST.json\n\
                    rcore-engine-feasibility [--root] PROFILE.rcore";

fn main() -> Result<()> {
    let arguments: Vec<_> = env::args().skip(1).collect();
    let mut output = io::stdout().lock();
    match arguments.as_slice() {
        [command, manifest, destination] if command == "pack" => {
            let manifest = Path::new(manifest).canonicalize()?;
            let directory = manifest
                .parent()
                .ok_or("Expected a language manifest file")?;
            let content = read(&manifest, pack::MAX_MANIFEST_BYTES)?;
            let archive = pack::build(&content, |path| {
                let source = directory
                    .join(path)
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !source.starts_with(directory) {
                    return Err(format!("Source {path:?} is outside the manifest directory"));
                }
                read(&source, 2_000_000).map_err(|error| error.to_string())
            })?;
            fs::write(destination, serde_json::to_vec(&archive)?)?;
        }
        [command, archive] if command == "inspect" => {
            serde_json::to_writer_pretty(&mut output, &read_archive(archive)?.inspect()?)?;
        }
        [command, archive, request] if matches!(command.as_str(), "check" | "run") => {
            let archive = read_archive(archive)?;
            let request: RunRequest = serde_json::from_str(&read(Path::new(request), 2_000_000)?)?;
            if command == "check" {
                serde_json::to_writer_pretty(&mut output, &archive.check(request)?)?;
            } else {
                serde_json::to_writer_pretty(&mut output, &archive.run(request)?)?;
            }
        }
        [flag, path] if flag == "--root" => {
            let source = read(Path::new(path), pack::MAX_MANIFEST_BYTES)?;
            let solutions = rcore_engine_feasibility::solve_root_source(path, &source)?;
            serde_json::to_writer_pretty(&mut output, &solutions)?;
        }
        [path]
            if !matches!(
                path.as_str(),
                "pack" | "inspect" | "check" | "run" | "--root"
            ) =>
        {
            let source = read(Path::new(path), pack::MAX_MANIFEST_BYTES)?;
            let cases = rcore_engine_feasibility::run_source(path, &source)?;
            serde_json::to_writer_pretty(&mut output, &cases)?;
        }
        _ => return Err(USAGE.into()),
    }
    Ok(())
}

fn read_archive(path: &str) -> Result<Archive> {
    Ok(serde_json::from_str(&read(
        Path::new(path),
        pack::MAX_ARCHIVE_WIRE_BYTES,
    )?)?)
}

fn read(path: &Path, limit: usize) -> Result<String> {
    let mut text = String::new();
    File::open(path)
        .and_then(|file| file.take(limit as u64 + 1).read_to_string(&mut text))
        .map_err(|error| format!("{}: {error}", path.display()))?;
    if text.len() > limit {
        return Err(format!("{} exceeds the {limit}-byte input limit", path.display()).into());
    }
    Ok(text)
}
