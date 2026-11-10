//! Handwritten CLI for checking examples and recording model runs.
use examples_petri::{DEFAULT_END_TIME, Scenario, TimedPetri, profile};
use examples_support::{Loaded, Source, Text, load_rcore_text};
use intersect_run::Policy;
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path, process::ExitCode};

const USAGE: &str = "examples-run petri MODEL [--scenario JSON] [--until 20s] [--policy first|seeded] [--seed N] --out TRACE\nexamples-run catalog check [MODEL...]\nexamples-run library check DEFINITION.rcore GRAMMAR.xtext MODEL.library...";

fn read(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("{path}: {error}"))
}

fn source(path: &str) -> Result<Source, String> {
    let uri = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Expected a source file name in {path}"))?;
    Ok(Source {
        uri: uri.into(),
        text: read(path)?,
    })
}

fn duration(value: &str) -> Result<u64, String> {
    let (amount, scale) = if let Some(amount) = value.strip_suffix("ms") {
        (amount, 1)
    } else if let Some(amount) = value.strip_suffix('s') {
        (amount, 1000)
    } else {
        return Err(format!("Duration {value:?} needs an ms or s suffix"));
    };
    amount
        .parse::<u64>()
        .ok()
        .and_then(|n| n.checked_mul(scale))
        .ok_or_else(|| format!("Invalid duration {value:?}"))
}

fn check(loaded: &Loaded) -> Result<(), String> {
    for diagnostic in &loaded.diagnostics {
        let location = diagnostic
            .location
            .as_ref()
            .map_or_else(String::new, |loc| {
                loc.span.map_or_else(
                    || loc.resource.clone(),
                    |(start, end)| format!("{}:{start}..{end}", loc.resource),
                )
            });
        eprintln!(
            "{location}: {}: {}",
            diagnostic.issue.code, diagnostic.issue.message
        );
    }
    if loaded.has_errors() {
        return Err("Model has validation errors".into());
    }
    Ok(())
}

fn run_petri(model: &str, options: &[String]) -> Result<(), String> {
    let mut scenario = Scenario::default();
    let mut policy = Policy::First;
    let mut seed = 0;
    let mut until = DEFAULT_END_TIME;
    let mut output = None;
    let mut options = options.iter();
    while let Some(flag) = options.next() {
        let value = options
            .next()
            .ok_or_else(|| format!("Missing value for {flag}"))?;
        match flag.as_str() {
            "--scenario" => {
                scenario =
                    serde_json::from_str(&read(value)?).map_err(|e| format!("{value}: {e}"))?
            }
            "--policy" => {
                policy = match value.as_str() {
                    "first" => Policy::First,
                    "seeded" => Policy::Seeded,
                    _ => return Err(format!("Unknown policy {value:?}")),
                }
            }
            "--seed" => {
                seed = value
                    .parse()
                    .map_err(|e| format!("Invalid seed {value:?}: {e}"))?
            }
            "--until" => until = duration(value)?,
            "--out" => output = Some(Path::new(value)),
            _ => return Err(format!("Unknown option {flag}")),
        }
    }
    let output = output.ok_or("A trace output path is required (--out)")?;
    let source = source(model)?;
    let digest = format!("{:x}", Sha256::digest(source.text.as_bytes()));
    let loaded = examples_petri::load(&[source])?;
    check(&loaded)?;
    let net = TimedPetri::from_loaded(&loaded).map_err(|e| e.to_string())?;
    let (outcome, trace) = net
        .execute(&profile(policy, seed, until), scenario, Some(digest))
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(&trace).map_err(|e| e.to_string())?;
    if let Some(parent) = output.parent().filter(|path| !path.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::write(output, json).map_err(|e| format!("{}: {e}", output.display()))?;
    let marking = net
        .net()
        .places
        .iter()
        .map(|place| format!("{}={}", place.name, outcome.state.tokens[&place.id]))
        .collect::<Vec<_>>()
        .join(", ");
    println!(
        "{:?} at {} ms, {} steps. {marking}",
        outcome.reason, outcome.time, outcome.steps
    );
    Ok(())
}

fn run(args: &[String]) -> Result<(), String> {
    let [command, arg, rest @ ..] = args else {
        return Err(USAGE.into());
    };
    match (command.as_str(), arg.as_str(), rest) {
        ("petri", model, options) => run_petri(model, options),
        ("catalog", "check", models) => {
            let loaded = if models.is_empty() {
                examples_catalog::load_sample()?
            } else {
                let sources = models
                    .iter()
                    .map(|path| source(path))
                    .collect::<Result<Vec<_>, _>>()?;
                examples_support::load(&examples_catalog::LANGUAGE, &sources)?
            };
            check(&loaded)?;
            println!("Catalog checked {} objects.", loaded.model.objects().len());
            Ok(())
        }
        ("library", "check", [definition, grammar, models @ ..]) if !models.is_empty() => {
            let sources = models
                .iter()
                .map(|path| source(path))
                .collect::<Result<Vec<_>, _>>()?;
            load_rcore_text(
                "urn:intersect:example:library:1",
                Text {
                    uri: "library.rcore",
                    content: &read(definition)?,
                },
                Text {
                    uri: "library.xtext",
                    content: &read(grammar)?,
                },
                &sources,
            )?;
            println!("Library checked {} resource(s).", sources.len());
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<_> = env::args().skip(1).collect();
    if args == ["--help"] || args == ["-h"] {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
