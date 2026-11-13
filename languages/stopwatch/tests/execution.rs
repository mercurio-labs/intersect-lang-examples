type TestResult = Result<(), Box<dyn std::error::Error>>;
#[test]
fn resume_excludes_stopped_time() -> TestResult {
    let result = examples_stopwatch::run(examples_stopwatch::SAMPLE)?;
    assert_eq!(
        result["summary"],
        serde_json::json!({"state":"stopped","elapsed_ms":2750,"time_ms":3250})
    );
    assert_eq!(result, examples_stopwatch::run(examples_stopwatch::SAMPLE)?);
    Ok(())
}
#[test]
fn invalid_transitions_are_recorded_and_do_not_change_state() -> TestResult {
    let result = examples_stopwatch::run("stopwatch Test { stop start start wait 10ms stop }")?;
    assert_eq!(result["summary"]["elapsed_ms"], 10);
    assert_eq!(
        result["trace"]["entries"]
            .as_array()
            .ok_or("Missing entries")?
            .iter()
            .filter(|e| e["kind"] == "input_rejected")
            .count(),
        2
    );
    Ok(())
}
#[test]
fn open_running_watch_and_invalid_durations() -> TestResult {
    assert_eq!(
        examples_stopwatch::run("stopwatch Test { start wait 30ms }")?["summary"]["elapsed_ms"],
        30
    );
    assert!(examples_stopwatch::run("stopwatch Test { wait 3601s }").is_err());
    assert!(examples_stopwatch::run("stopwatch Test { wait -1ms }").is_err());
    Ok(())
}
