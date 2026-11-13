# Timed Petri nets

- **Imported.** The metamodel and rules are authored in Rcore, with an Xtext grammar.
- **Consumed.** The shared support crate prepares the authored Rcore metamodel, parses `.petri` models, resolves arc
  places within their owning net, validates structure, and runs the Rcore
  validation rules. Rule issues include the source resource and object span.
- **Semantically verified.** The definition tests cover three valid nets and one
  located negative control for each validation rule.

The grammar admits integer token counts and arc weights, and delays in
milliseconds or seconds. A place with an omitted initial count starts empty.
An omitted arc weight represents one token.

## Full lifecycle in Rust

Run the commented [Petri lifecycle example](examples/petri_lifecycle.rs) from
the repository root:

```sh
cargo run --profile test-fast -p examples-petri --example petri_lifecycle
```

It supplies the model and scenario sources, prepares the authored definitions,
parses and links the model, reports located validation issues, inspects the
checked net, and executes the two-coins scenario. It then saves and reloads the
trace and verifies that restoring a compiled language pack produces the same
complete trace. The expected result is two cups and quiescence at 6,000 ms.

The example writes `target/runs/petri-lifecycle/coffee.trace.json` and
`target/runs/petri-lifecycle/petri.pack`. Start `python -m http.server 8000`
from the repository root and open
[the trace replay](http://localhost:8000/viewer/?trace=../target/runs/petri-lifecycle/coffee.trace.json).
The [support loader](../../support/src/lib.rs) shows the individual definition
preparation, frozen-store construction, linking and validation calls behind
`examples_petri::load`.

For interactive execution of edited model text in WASM, see the root
[browser example instructions](../../README.md#browser-examples).

## Execution

The `petri.timed-firing.v1` profile uses one-millisecond ticks. A transition
takes all of its input tokens when it starts and adds its outputs when its
delay expires. Repeated arcs to the same place add their weights. A
completion precedes scenario inputs at the same tick. Instantaneous firings
are interleaved, with the first policy ordering transitions by name and
breaking name ties by model order. The seeded policy chooses among the same
ordered candidates. Scenario inputs name external transitions and carry
integer `at_ms` times. Unknown, ambiguous or disabled inputs are recorded as
rejections.

The golden traces check the two-coins coffee scenario and the seeded
conflict. The conflict test checks token conservation and compares every
visited marking with an independent untimed reachability enumeration.
The zero-delay cycle demonstrates the per-instant budget. The profile
covers firing durations and integer markings. Continuous-time and
synchronized transition selection are outside this example.
