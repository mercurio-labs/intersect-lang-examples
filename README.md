# Intersect language examples

Small language packages that use [Intersect](https://github.com/mercurio-labs/intersect).
[Catalog](languages/catalog/README.md) demonstrates parsing and Rcore scoping
across two resources. The support crate prepares the definitions and loads
the model through the shared frozen engine. [Petri](languages/petri/README.md)
adds net-local scoping and Rcore validation with source locations.
[Library](languages/library/README.md) runs a derived feature and an operation
written in Rcore.

## Run and replay

From the repository root:

~~~sh
cargo run -p examples-run -- petri languages/petri/models/coffee.petri --scenario languages/petri/scenarios/two-coins.scenario.json --until 20s --policy first --out target/runs/coffee.trace.json
python -m http.server 8000
~~~

Open `http://localhost:8000/viewer/` and choose the generated trace. You can
also open `/viewer/?trace=../target/runs/coffee.trace.json` on the same server.
Play, pause, step through trace entries, or scrub through simulation time.
An optional layout JSON maps stable node IDs to `{"x": number, "y": number}`
within the graph's view box. Choose it with the layout picker or pass a
relative `layout` URL.

![CoffeeMachine trace replay at 4450 ms](viewer/coffee-replay.png)

Use `examples-run catalog check` to check the bundled catalog or pass model
paths after `check`. Use `examples-run library check` for the bundled Library
sample, or pass model paths after `check`.

## Compiled language packs

Build trusted host-local packs for Catalog and Petri, then load them from a
new runner invocation:

~~~sh
cargo run -p examples-run -- pack catalog target/packs/catalog.pack
cargo run -p examples-run -- pack petri target/packs/petri.pack
cargo run -p examples-run -- catalog check --pack target/packs/catalog.pack
cargo run -p examples-run -- petri languages/petri/models/coffee.petri --pack target/packs/petri.pack --scenario languages/petri/scenarios/two-coins.scenario.json --until 20s --out target/runs/coffee-packed.trace.json
~~~

Each pack retains the compiled grammar and schema, source provenance, and
verified Rcore bindings. The runner checks the pack's integrity and exact
compiler and source identities, then restores the compiled data and links and
validates the model. `--pack` fails on an invalid or incompatible pack. Rebuild
the pack after a definition or compiler change. Use packs built by your own
runner; integrity digests do not authenticate other publishers. Petri firing
and scheduling use the Rust host and the separately supplied model and scenario.

## Checks

Run quick tests from the repository root with the test reporter.

```sh
cargo fmt --all --check
cargo clippy --all-targets -p examples-support -p examples-catalog -p examples-petri -p examples-library -p examples-run -- -D warnings
python -B tools/test_report.py run -- --profile test-fast -p examples-support -p examples-catalog -p examples-petri -p examples-library -p examples-run --lib --bins --tests
```

CI needs an `INTERSECT_CORE_TOKEN` with read access to the private core repository.
The workspace manifest pins all core dependencies to one revision.

### Working with a local core

Check out the pinned revision in a sibling directory named `intersect`.
Until the revision is available upstream, supply Cargo's path patches on the
command line. Use the same patches for Clippy.

```sh
python -B tools/test_report.py run -- --profile test-fast -p examples-support -p examples-catalog -p examples-petri -p examples-library -p examples-run --lib --bins --tests \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-model.path="../intersect/crates/intersect-model"' \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-xtext.path="../intersect/crates/intersect-xtext"' \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-run.path="../intersect/crates/intersect-run"'
```

The patches can rewrite the local lockfile. Keep the committed lockfile
resolved to the git revision. A fresh offline build also needs the revision
in Cargo's Git cache.
