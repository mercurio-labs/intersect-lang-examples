use intersect_example_state_machine::{Harness, SAMPLE, SCENARIO};
use std::{env, fs, process::ExitCode};

fn execute() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let (source, events): (String, Vec<String>) = if let Some(path) = args.next() {
        (
            fs::read_to_string(path).map_err(|error| error.to_string())?,
            args.collect(),
        )
    } else {
        (
            SAMPLE.into(),
            serde_json::from_str(SCENARIO).map_err(|error| error.to_string())?,
        )
    };
    let mut harness = Harness::new()?;
    harness.load(&source)?;
    let run = harness.run(&events)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&run.trace).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn main() -> ExitCode {
    match execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
