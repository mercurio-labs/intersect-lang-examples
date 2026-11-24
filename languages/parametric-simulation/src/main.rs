use intersect_thermal_profile::{Inputs, Method, Request, compare};
use std::{env, process::ExitCode};

fn execute() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let (method, current) = match args.as_slice() {
        [] => (Method::Ode, Inputs::BASELINE),
        [method, power, loss] => {
            let method = match method.as_str() {
                "analytic" => Method::Analytic,
                "ode" => Method::Ode,
                _ => return Err("Method must be analytic or ode".into()),
            };
            let power = power.parse().map_err(|_| "Invalid heater power")?;
            let loss = loss.parse().map_err(|_| "Invalid heat loss")?;
            (method, Inputs { power, loss })
        }
        _ => {
            return Err(
                "Usage: intersect-thermal-profile [analytic|ode POWER_W LOSS_W_PER_C]".into(),
            );
        }
    };
    let report = compare(Request { method, current }).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
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
