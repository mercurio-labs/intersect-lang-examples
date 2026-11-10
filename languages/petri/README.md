# Timed Petri nets

- **Imported.** The example authors its own Ecore, Xtext, and Rcore definitions.
- **Consumed.** The shared support crate parses `.petri` models, resolves arc
  places within their owning net, validates structure, and runs the Rcore
  validation rules. Rule issues include the source resource and object span.
- **Semantically verified.** The definition tests cover three valid nets and one
  located negative control for each validation rule.

The grammar admits integer token counts and arc weights, and delays in
milliseconds or seconds. A place with an omitted initial count starts empty.
An omitted arc weight represents one token.

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
