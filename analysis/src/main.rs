mod mapping;
mod pack;
mod report;
mod sysml;

use intersect_model::definitions::pack::FileDigest;
use intersect_run::analysis::{AnalysisError, ErrorCode, Source};
use mapping::Objects;
use report::{Case, Report};
use std::{io::Write, path::Path, process::ExitCode};

const USAGE: &str = "intersect-analysis pack METAMODEL GRAMMAR MAPPING OUTPUT
intersect-analysis check PACK MODEL [--case SUBJECT::CASE] [--report FILE]
intersect-analysis sysml PACK MODEL --case QUALIFIED_NAME [--inputs FILE] [--body-pack PACK] [--report FILE]";

const TEXT_LIMITS: intersect_text::EvaluationLimits = intersect_text::EvaluationLimits {
    resources: Some(1),
    input_bytes: Some(256 * 1024),
    elements_per_resource: Some(10_000),
    tokens_per_resource: Some(100_000),
    steps_per_resource: Some(1_000_000),
    nesting: 64,
};

fn main() -> ExitCode {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let worker = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || run(&args));
    let result = worker.map_err(|error| error.to_string()).and_then(|join| {
        join.join()
            .map_err(|_| "analysis worker panicked".to_owned())?
    });
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(error) => {
            eprintln!("intersect-analysis: {error}");
            ExitCode::from(2)
        }
    }
}

fn run(args: &[String]) -> Result<bool, String> {
    match args {
        [command] if command == "--help" || command == "-h" => println!("{USAGE}"),
        [command, structure, grammar, mapping, output] if command == "pack" => {
            let bytes = pack::build(Path::new(structure), Path::new(grammar), Path::new(mapping))?;
            write(Path::new(output), &bytes)?;
        }
        [command, pack, model, options @ ..] if command == "check" => {
            let options = options_for_check(options, false)?;
            return finish(
                check(Path::new(pack), Path::new(model), options.case)?,
                options.output,
            );
        }
        [command, pack, model, args @ ..] if command == "sysml" => {
            let options = options_for_check(args, true)?;
            let case = options.case.ok_or("sysml requires --case QUALIFIED_NAME")?;
            return finish(
                sysml::run(
                    Path::new(pack),
                    Path::new(model),
                    case,
                    options.body,
                    options.inputs,
                )?,
                options.output,
            );
        }
        _ => return Err(USAGE.into()),
    }
    Ok(true)
}

#[derive(Default)]
struct CheckOptions<'a> {
    case: Option<&'a str>,
    output: Option<&'a Path>,
    body: Option<&'a Path>,
    inputs: Option<&'a Path>,
}

fn options_for_check(options: &[String], sysml: bool) -> Result<CheckOptions<'_>, String> {
    let mut options = options.iter();
    let mut result = CheckOptions::default();
    while let Some(flag) = options.next() {
        let value = options
            .next()
            .ok_or_else(|| format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--case" if result.case.is_none() => result.case = Some(value.as_str()),
            "--report" if result.output.is_none() => result.output = Some(Path::new(value)),
            "--body-pack" if sysml && result.body.is_none() => result.body = Some(Path::new(value)),
            "--inputs" if sysml && result.inputs.is_none() => {
                result.inputs = Some(Path::new(value))
            }
            _ => return Err(format!("unexpected or repeated option {flag}")),
        }
    }
    Ok(result)
}

fn diagnostic(diagnostic: &intersect_model::definitions::schema::Diagnostic) -> AnalysisError {
    AnalysisError::new(
        ErrorCode::Invalid,
        &diagnostic.message,
        Some(&Source {
            uri: diagnostic.source.clone(),
            start: diagnostic.start,
            end: diagnostic.end,
        }),
    )
}

fn check(pack: &Path, model: &Path, case: Option<&str>) -> Result<Report, String> {
    let pack = pack::load(pack)?;
    let source = intersect_text::Source {
        uri: resource_uri(model),
        text: pack::read_source(model)?,
    };
    let model_digest = FileDigest::of(source.text.as_bytes()).sha256;
    let result = intersect_text::evaluate_with_limits(&pack.language, &[source], TEXT_LIMITS);
    let model = result.model;
    let objects: Objects<'_> = model
        .elements
        .iter()
        .map(|object| (object.id.as_str(), object))
        .collect();
    let cases = if !result.diagnostics.is_empty() {
        result
            .diagnostics
            .iter()
            .map(|d| Case::error("<model>", diagnostic(d)))
            .collect()
    } else {
        match pack.mapping.select(&model, &objects, case) {
            Ok(selections) => {
                let cases: Vec<_> = selections
                    .into_iter()
                    .map(|selection| report::execute(&pack.mapping, &selection, &objects))
                    .collect();
                if cases.is_empty() {
                    vec![Case::error(
                        case.unwrap_or("<model>"),
                        AnalysisError::new(ErrorCode::Invalid, "no matching analysis case", None),
                    )]
                } else {
                    cases
                }
            }
            Err(error) => vec![Case::error("<model>", error)],
        }
    };
    Ok(Report::new(pack.digest, model_digest, cases))
}

fn finish(report: Report, output: Option<&Path>) -> Result<bool, String> {
    if let Some(path) = output {
        let bytes = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
        write(path, &bytes)?;
    }
    for case in &report.cases {
        println!("{:5} {}", case.status.label(), case.name);
        if let Some(summary) = case.summary() {
            println!("      {summary}");
        }
        if let Some(diagnostic) = &case.diagnostic {
            if let Some(source) = &diagnostic.source {
                println!(
                    "      {}:{}..{} {}",
                    source.uri, source.start, source.end, diagnostic.message
                );
            } else {
                println!("      {}", diagnostic.message);
            }
        }
    }
    Ok(report.passed())
}

fn resource_uri(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace('%', "%25")
        .replace('#', "%23")
        .replace('?', "%3F")
        .replace(' ', "%20")
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file = path.file_name().ok_or("expected an output file path")?;
    let mut temporary = file.to_os_string();
    temporary.push(format!(".tmp-{}", std::process::id()));
    let temporary = path.with_file_name(temporary);
    let mut file = std::fs::File::create_new(&temporary)
        .map_err(|error| format!("{}: {error}", temporary.display()))?;
    let result = file.write_all(bytes);
    drop(file);
    let result = result.and_then(|()| std::fs::rename(&temporary, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| format!("{}: {error}", path.display()))
}
