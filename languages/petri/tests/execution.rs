use examples_petri::{DEFAULT_END_TIME, Scenario, TimedPetri, profile};
use examples_support::Source;
use intersect_run::{EndReason, Policy, Trace, TraceKind};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, VecDeque};

const COFFEE: &str = include_str!("../models/coffee.petri");
const CONFLICT: &str = include_str!("../models/conflict.petri");
const ZENO: &str = include_str!("../models/zeno.petri");
const COINS: &str = include_str!("../scenarios/two-coins.scenario.json");

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn net(uri: &str, text: &str) -> Result<TimedPetri, Box<dyn std::error::Error>> {
    let loaded = examples_petri::load(&[Source {
        uri: uri.into(),
        text: text.into(),
    }])?;
    Ok(TimedPetri::from_loaded(&loaded)?)
}

fn digest(text: &str) -> Option<String> {
    Some(format!("{:x}", Sha256::digest(text.as_bytes())))
}

fn golden(name: &str, trace: &Trace) -> TestResult {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(format!("{name}.trace.json"));
    let actual = serde_json::to_vec_pretty(trace)?;
    let expected = std::fs::read(path)?;
    assert_eq!(actual, expected);
    Ok(())
}

#[test]
fn two_coins_complete_at_three_and_six_seconds() -> TestResult {
    let net = net("coffee.petri", COFFEE)?;
    let scenario = serde_json::from_str(COINS)?;
    let (outcome, trace) = net.execute(
        &profile(Policy::First, 0, DEFAULT_END_TIME),
        scenario,
        digest(COFFEE),
    )?;
    assert_eq!(
        (outcome.reason, outcome.time),
        (EndReason::Quiescence, 6000)
    );
    let cup = net
        .net()
        .places
        .iter()
        .find(|place| place.name == "cups")
        .ok_or("Missing cups")?;
    assert_eq!(outcome.state.tokens.get(&cup.id), Some(&2));
    let completions: Vec<_> = trace
        .entries
        .iter()
        .filter(|entry| entry.kind == TraceKind::EventDelivered && entry.label == "complete brew")
        .filter_map(|entry| {
            entry
                .observation
                .as_ref()
                .map(|obs| (entry.time, obs["marking"][&cup.id].as_u64()))
        })
        .collect();
    assert_eq!(completions, [(3000, Some(1)), (6000, Some(2))]);
    golden("coffee", &trace)
}

// Independent finite untimed oracle. It uses vectors of place counts,
// explicitly enumerates all outgoing transitions, and never calls Semantics.
fn reachable(initial: Vec<u64>, transitions: &[([u64; 3], [u64; 3])]) -> BTreeSet<Vec<u64>> {
    let mut visited = BTreeSet::from([initial.clone()]);
    let mut queue = VecDeque::from([initial]);
    while let Some(marking) = queue.pop_front() {
        for (inputs, outputs) in transitions {
            if marking
                .iter()
                .zip(inputs)
                .any(|(count, weight)| count < weight)
            {
                continue;
            }
            let next: Vec<_> = marking
                .iter()
                .zip(inputs)
                .zip(outputs)
                .map(|((count, input), output)| count - input + output)
                .collect();
            if visited.insert(next.clone()) {
                queue.push_back(next);
            }
        }
    }
    visited
}

#[test]
fn conflict_is_repeatable_reachable_and_conservative() -> TestResult {
    let net = net("conflict.petri", CONFLICT)?;
    let run = |policy, seed| {
        net.execute(
            &profile(policy, seed, DEFAULT_END_TIME),
            Scenario::default(),
            digest(CONFLICT),
        )
    };
    let (_, first) = run(Policy::First, 0)?;
    let (_, seeded) = run(Policy::Seeded, 0)?;
    let (_, repeated) = run(Policy::Seeded, 0)?;
    assert_eq!(first.entries[1].label, "chooseLeft");
    assert_eq!(seeded.entries[1].label, "chooseRight");
    assert_eq!(serde_json::to_vec(&seeded)?, serde_json::to_vec(&repeated)?);
    let possible = reachable(
        vec![1, 0, 0],
        &[([1, 0, 0], [0, 1, 0]), ([1, 0, 0], [0, 0, 1])],
    );
    assert_eq!(possible.len(), 3);
    for seed in 0..8 {
        let (_, trace) = run(Policy::Seeded, seed)?;
        for snapshot in trace
            .entries
            .iter()
            .filter_map(|entry| entry.observation.as_ref())
        {
            let marking = net
                .net()
                .places
                .iter()
                .map(|place| {
                    snapshot["marking"][&place.id]
                        .as_u64()
                        .ok_or("Missing token count")
                })
                .collect::<Result<Vec<_>, _>>()?;
            assert_eq!(marking.iter().sum::<u64>(), 1);
            assert!(possible.contains(&marking), "{marking:?}");
        }
    }
    golden("conflict-seeded", &seeded)
}

#[test]
fn zeno_stops_at_instant_budget() -> TestResult {
    let net = net("zeno.petri", ZENO)?;
    let mut profile = profile(Policy::First, 0, DEFAULT_END_TIME);
    profile.budgets.steps_per_instant = 9;
    let (outcome, trace) = net.execute(&profile, Scenario::default(), None)?;
    assert_eq!(
        (outcome.reason, outcome.time, outcome.steps),
        (EndReason::StepsPerInstant, 0, 9)
    );
    assert_eq!(
        trace.entries.last().map(|entry| entry.kind),
        Some(TraceKind::RunEnd)
    );
    Ok(())
}

#[test]
fn insufficient_tokens_reject_external_input() -> TestResult {
    let net = net(
        "reject.petri",
        r#"net Reject {
        place token = 1
        place received
        transition demand external : token, token -> received
    }"#,
    )?;
    let scenario = serde_json::from_str(r#"{"inputs":[{"at_ms":1,"transition":"demand"}]}"#)?;
    let (outcome, trace) =
        net.execute(&profile(Policy::First, 0, DEFAULT_END_TIME), scenario, None)?;
    let rejected = trace
        .entries
        .iter()
        .find(|entry| entry.kind == TraceKind::InputRejected)
        .ok_or("Missing rejected event")?;
    assert_eq!(rejected.time, 1);
    assert_eq!(
        rejected.label,
        "input demand: external transition is not enabled"
    );
    assert_eq!(outcome.state.tokens.values().sum::<u64>(), 1);
    assert_eq!(outcome.steps, 0);
    Ok(())
}
