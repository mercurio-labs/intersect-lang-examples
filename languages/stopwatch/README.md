# Stopwatch: commands, state and logical time

```text
stopwatch Demo {
  start
  wait 2s
  stop
  wait 500ms
  start
  wait 750ms
  stop
}
```

Run `cargo run --profile test-fast -p examples-stopwatch --example stopwatch_lifecycle`.
The sample stops at simulation time 3250 ms with elapsed time 2750 ms.

`language/stopwatch.rcore` defines Script/Command structure and the `next_state`
operation: idle -> running on start, running -> stopped on stop, stopped ->
running on start (resume); wait leaves the state unchanged. Other transitions
return invalid and are recorded as rejected inputs without changing state.
The browser's transition list is evaluated from this same Rcore operation.

`language/stopwatch.xtext` parses commands. `src/lib.rs` binds that checked model
and operation to Intersect Run. Run's queue schedules each next command after
the specified wait, with one-millisecond ticks. The adapter accumulates running
durations from Run's time. It never sleeps or reads the wall clock. An unfinished
running watch stays running at the last command's time; execution does not imply
an extra stop. The browser replays discrete observations at a display cadence.

The model is immutable during execution; transient phase/timing state belongs
to Run's state. The Rust walkthrough loads, executes, serializes and reloads the
result. The browser also downloads the portable trace. Limits: 64 KiB script,
256 commands and a one-hour timeline. Tests cover resume, stopped waits, invalid
transitions, repeatability, open running watches and invalid durations.

Open the examples site's Stopwatch landing page and simulator, or build it with
`python -B tools/build_web.py` and serve `dist/` over HTTP.
