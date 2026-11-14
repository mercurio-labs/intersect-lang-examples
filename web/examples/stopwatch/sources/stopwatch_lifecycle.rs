fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse authored commands, bind the Rcore state machine, execute through
    // Run's scheduler, then persist and reload its portable trace observations.
    let watch = examples_stopwatch::Stopwatch::load(examples_stopwatch::SAMPLE)?;
    let result = watch.execute()?;
    assert_eq!(result["summary"]["elapsed_ms"], 2750);
    std::fs::create_dir_all("target/runs")?;
    std::fs::write(
        "target/runs/stopwatch.json",
        serde_json::to_vec_pretty(&result)?,
    )?;
    let replay: serde_json::Value =
        serde_json::from_slice(&std::fs::read("target/runs/stopwatch.json")?)?;
    assert_eq!(result, replay);
    println!(
        "Stopped at 3250 ms of simulation time, with 2750 ms elapsed. Trace saved to target/runs/stopwatch.json"
    );
    Ok(())
}
