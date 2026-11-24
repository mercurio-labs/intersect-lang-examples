# Packaged Rcore execution profiles

Author a language package with `language.toml`. The optional execution section names a default profile and selects versioned built-in engines. The referenced Rcore modules supply model projections, callbacks, and engine wiring. Open or validate a package through Text as before. When a Run host prepares a profile, it resolves the selected engine and checks state, event, parameter, and signal bindings before execution.

```toml
[execution]
default = "thermostat"

[execution.profiles.thermostat]
engine = "intersect.coupled-ode@1"
source = "execution/thermostat.rcore"
```

The Run host installs `intersect.state-machine@1`, `intersect.timed-token-flow@1`, `intersect.ode@1`, and `intersect.coupled-ode@1` in native and WASM builds. Format 3 of the existing Text archive binds the execution declarations and their source digests to the archive revision. Packages without execution keep format 2. Adding or editing an execution profile preserves the structural schema revision.

The Rcore and SysML hosts use the same Run engine catalog for exact engine
versions. Each host registers the engines it can bind to linked models and the
request inputs it accepts for each engine. For example, the Rcore host accepts
numeric case overrides for coupled ODE profiles. Deferred charts require
distinct event ticks. The standalone Rcore root-finding command also resolves
its engine through the catalog.

The checked model comes from the pack's retained grammar and Rcore scopes. [Airlock](qualification/airlock/language.toml) retains the original grammar, metamodel, and transition IDs. [The thermostat](qualification/thermostat/language.toml) projects its initial temperature and threshold from a checked enclosure model. An individual run can override a known case input, such as heater power. Each response records the selected profile, engine contract, archive and schema revisions, and digests of the profile source, model input, and run options.

The packing CLI writes the full Text archive file map as JSON. The native CLI and WASM host both verify that archive through the Text importer, then prepare and execute the profile with the same Run code. The package runner is available through the standalone CLI and Web Worker transport. Airlock and thermal UI entry points continue to use their existing paths.

## Qualification

- The [package parity harness](tools/package-parity.mjs) matched complete run output across the native CLI, Node WASM, and a Chromium Web Worker. It covered Airlock's default and explicitly selected profiles, the thermostat at an overridden 200 W, and an edited warm-start model.
- All three hosts refused unknown profiles, tampered execution source, an unbound state signal, and execution against a language-only archive. The pack builder refused an unsupported engine version.
- The Run host suite passed 20 tests. The Text suite passed 954 tests on its existing Model pin, including four new archive tests. Strict Clippy, formatting, and WASM builds passed.
- With the shared state machine, the Run host passed all 20 tests again. Native and Node WASM traces matched for all 10 standalone profiles and the packaged Airlock and thermostat scenarios. At 120 W and 250 W, the thermostat produced 121 samples each at 15-second intervals and recorded 23 and 83 crossings, respectively. Every interval between crossings agreed with the closed-form solution to within 1 millisecond. The pump changed modes before sampling at the 2, 3, and 4 second crossings.
- Moving the integer threshold search into Run preserved all 10 native traces byte for byte. The locked tests and native and Node WASM checks passed with the shared locator.

## Build and reproduce

The standalone host uses immutable Git revisions in `Cargo.toml` and
`Cargo.lock`. Text supplies archive import and shares its pinned Model compiler
with the host. Run supplies the chart engine, RK4 integrator, root solver, and
integer threshold locator. This build starts from an Examples checkout and
fetches its dependencies through Cargo.

From this directory, use Rust 1.99.1 and Node.js. Pass an installed Playwright module as the optional third argument for the Chromium Worker check.

```sh
cargo +1.99.1 fetch --locked
RUSTUP_TOOLCHAIN=1.99.1 python3 -B ../../tools/test_report.py run -- --locked --lib --test all
cargo +1.99.1 build --locked --release
RUSTFLAGS='-C link-arg=-zstack-size=4194304' \
  cargo +1.99.1 build --locked --release --lib --target wasm32-unknown-unknown
node tools/package-parity.mjs \
  target/wasm32-unknown-unknown/release/rcore_engine_feasibility.wasm \
  target/release/rcore-engine-feasibility
```

The same executable supports `pack LANGUAGE.toml ARCHIVE.json`, `inspect ARCHIVE.json`, `check ARCHIVE.json REQUEST.json`, and `run ARCHIVE.json REQUEST.json`. Here is a request for the default thermostat profile.

```json
{
  "model": { "sources": [{ "uri": "cabin.enclosure", "text": "enclosure Cabin" }] },
  "inputs": { "parameters": { "current": { "power": 200.0 } } }
}
```

## Earlier engine feasibility experiment

The prototype ran every time-based simulation found in the examples and Workbench inventory through a small set of installed Rust engines. It loaded Rcore text at run time, including executable equations and guards, and used the existing Intersect Run kernel. It also coupled a state machine and RK4 integration on a single clock. The experiment lives on `codex/rcore-engine-feasibility`, based on the examples repository's `develop` branch at `2327509`. The thermal equations and reference settings come from preview revision `093b4d1`.

## What ran

| Model or scenario | Engines | Evidence |
| --- | --- | --- |
| Airlock | Hierarchical state machine | Matched all seven observed active paths and the rejected lock. An Rcore projection read the original `Machine` schema and retained state and transition identities. |
| Stopwatch | The same state-machine engine with a state clock | Matched the command-time observations and the final 2,750 ms elapsed at 3,250 ms. An Rcore projection read ordered commands from the original `Script` schema and computed their timestamps. |
| Petri coffee, seeded conflict, and zero-delay cycle | Timed token flow | Matched every golden entry for coffee and seeded conflict. Coffee also matched when projected from the checked `Net` schema. The zero-delay cycle stopped at the per-instant step budget. |
| Heated enclosure | RK4 integration and a separate scalar root solver | Both heater cases produced 121 temperatures on the original 15-second grid. The RK4 samples agreed with the closed form within 2 × 10⁻⁸ °C. Runtime Rcore residuals found equilibrium at 44 °C and 70 °C. |
| Thermostat-controlled enclosure | State machine and RK4 in one Run trace | Both curves still had 121 regular samples. The controller switched off at 40 °C and on at 38 °C between samples. The first shutoff was at 430.023 s for 120 W and 122.599 s for 250 W. Each agreed with the closed-form timing to about one millisecond. |
| Pump-controlled tank | The same state-machine and RK4 coordinator | Level and pump mode matched an independent piecewise-linear solution. When a crossing and sample shared a tick, the observation contained the new controller mode. |
| Spring oscillator | The same RK4 engine | Two coupled state variables matched sine and cosine over 61 samples. Editing the Rcore frequency changed the trace in the same WASM instance. |
| Maintenance job | The same state-machine engine | A second checked metamodel mapped `Job`, `Phase`, and `Advance` to engine roles. Its Rcore guard blocked release until inspection. |
| Service desk | The same timed token-flow engine | Served three arrivals through one server, including an arrival at a completion tick. The completion ran first. Tokens represented interchangeable jobs. |

The Workbench uses the Petri and Stopwatch implementations. The Library editor and Catalog explorer exercise model editing and reference navigation. Mercurio's scalar evaluation example and the Learn SysML simulation-integration lesson cover analysis results and derived attributes.

## How the binding works

An Rcore function identifies the engine and its contract version. Other selected functions return typed records for states, variables, transitions, cases, and wiring. A projection can take a receiver from a checked metamodel and read it through Model's bounded supplemental-function API. For example, [the Airlock projection](profiles/airlock-model.rcore) and [the maintenance projection](profiles/maintenance-model.rcore) give differently named structures to the same state machine. The Petri example's original loader and the experiment share the [same firing implementation](../../languages/petri/src/engine.rs).

The adapter compiles selected callbacks before dispatch, validates the engine-specific record and port contracts, and checks the signatures and purity of guards and numerical callbacks. The underlying VM executes those callbacks with its existing limits. This uses [current Rcore function syntax](profiles/thermostat.rcore), with records and named functions carrying the information proposed for a future `run` declaration.

In the combined engine, the state machine provides a boolean indicating whether `Heating` is active. That boolean goes into the Rcore derivative used by RK4. A crossing monitor finds the earliest detected threshold in the next integration interval, bisects to the first qualifying millisecond tick, and schedules a Run event there. The coordinator applies the controller transition and resumes from the accepted temperature with the new derivative. Simultaneous crossing events use declaration order and precede a sample at that tick.

## What the prototype establishes

- **Runtime engine reuse works.** The stand-alone profiles matched complete native and WASM traces. Checked model projections also ran natively for the existing Airlock, Stopwatch, and Petri schemas and the separate maintenance schema. The WASM parity harness was executed in Node.
- **Composition needs a time-coordination contract.** The tested coordinator supports one chart, one ODE system, continuous state across switches, directional thresholds, and a sample grid. It plans forward from accepted states because Run's event queue cannot schedule into the past. The prototype has no independent external input stream during a coupled advance. Supporting arbitrary graphs requires explicit event horizons, routing, simultaneous-event semantics, and bounded same-tick reactions.
- **Crossing localization is bounded by the integrator.** The detector brackets a crossing using step endpoints and quantizes it to milliseconds. A signal that crosses and returns within a step can escape detection. Stiff systems, resets of continuous state, and general guard root functions need their own solver and event policies.
- **Engine coverage and trace compatibility are separate.** Petri retained its golden event entries and language data. Chart and ODE traces use prototype observation contracts. The coverage comes from the stand-alone runner and checked model fixtures. Those fixtures were constructed with the existing Model API. Trace digests in the experiment identify Rcore profile source.
- **The numeric service has a smaller job than the demo.** The original analytic mode was exercised as a reference. Generic bisection handles bracketed roots and reports unbracketed residuals. The heated enclosure's underdetermined zero-loss, zero-power verdict remains a domain classification. The original thermal suite checked both zero-loss cases.
- **Additional engines would need different contracts.** Timed token flow covers a service desk with interchangeable jobs. Explicit job identity, FIFO routing, resource calendars, and utilization metrics would justify a process engine. Reachability can use deterministic successor enumeration from a chart or token-flow model. Dependency evaluation and constraint solving need their own result and capability contracts. Those services were assessed from the tested boundaries and remain design candidates.

The versioned engine catalog sits above Run. The Rcore adapter owns model
projection and callback preparation. The tested composition contract uses
chart-to-ODE wiring.

The direct Rcore profile and scalar-root commands are also available.

```sh
cargo +1.99.1 run --locked --release -- profiles/thermostat.rcore
cargo +1.99.1 run --locked --release -- --root profiles/thermal-equilibrium.rcore
```

The original Airlock and thermal suites passed on their existing locks. The legacy Petri and Stopwatch suites passed in a temporary copy with cached `syn` 3.0.10 in place of the lock's unavailable 3.0.9. The worktree's legacy lock remains at its original revision.
