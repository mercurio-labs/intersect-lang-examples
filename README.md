# Intersect language examples

Small language packages that use [Intersect](https://github.com/mercurio-labs/intersect).
[Catalog](languages/catalog/README.md) demonstrates parsing and Rcore scoping
across two resources. The support crate prepares the definitions and loads
the model through the shared frozen engine. [Petri](languages/petri/README.md)
adds net-local scoping and Rcore validation with source locations.
[Library](languages/library/README.md) runs a derived feature and an operation
written in Rcore.

[Stopwatch](languages/stopwatch/README.md) adds start/wait/stop commands, an Rcore state machine, and deterministic timing through Intersect Run.

## Lifecycle examples in code

Each walkthrough is executable Rust, with comments at the API boundaries and
checks on the result. Run these from the repository root:

| Example | Lifecycle | Command |
| --- | --- | --- |
| [Stopwatch](languages/stopwatch/examples/stopwatch_lifecycle.rs) | Parse commands, execute Rcore transitions with Run timing, save/replay observations | `cargo run --profile test-fast -p examples-stopwatch --example stopwatch_lifecycle` |
| [Petri](languages/petri/examples/petri_lifecycle.rs) | Prepare definitions, parse, scope, validate, inspect, run a scenario, serialize/reload its trace, restore a compiled language pack | `cargo run --profile test-fast -p examples-petri --example petri_lifecycle` |
| [Catalog](languages/catalog/examples/catalog_lifecycle.rs) | Load two resources, validate, inspect resolved references and source identities, build/restore a language pack | `cargo run --profile test-fast -p examples-catalog --example catalog_lifecycle` |
| [Library](languages/library/examples/library_lifecycle.rs) | Compile Rcore behavior, parse/check a model, read a derived feature, invoke an operation, export/restore the model | `cargo run --profile test-fast -p examples-library --example library_lifecycle` |

The examples write artifacts below `target/runs/`. Read the language READMEs
for expected outputs and the distinction between trace, model and language-pack
persistence. Pack restoration is a host-local demonstration; the browser loads
the authored definitions through the shared parser.

## Browser examples

Hosting is currently disabled. Download **examples-site** from a successful
[Browser examples build](https://github.com/mercurio-labs/intersect-lang-examples/actions/workflows/web.yml), unzip it,
then run `python -m http.server 8000` in the extracted directory and open
`http://localhost:8000/`. The site links below are reserved for future hosting.

[Open the interactive examples](https://mercurio-labs.github.io/intersect-lang-examples/)
— landing pages pair each Rust walkthrough with a runnable browser tool.

- [Stopwatch simulator](https://mercurio-labs.github.io/intersect-lang-examples/examples/stopwatch/): command text, an Rcore state machine, Run timing and trace replay.
- [Petri simulation](https://mercurio-labs.github.io/intersect-lang-examples/examples/petri/): timed firing and animated trace replay.
- [Library simulator](https://mercurio-labs.github.io/intersect-lang-examples/examples/library/): edit objects and source with synchronization, references and undo/redo.
- [Catalog explorer](https://mercurio-labs.github.io/intersect-lang-examples/examples/catalog/): edit two resources and follow resolved references.
- [Toolkit](toolkit/README.md): full language authoring and model/text workflows.

Edit the coffee net and scenario, select a deterministic firing policy, and run
them in your browser. The Rust language package compiles to WebAssembly; a web
worker parses, links, validates and executes the edited model. The existing
viewer replays the resulting trace with play/pause, stepping and a time slider.
Download the trace to use it with the standalone viewer. There is no runtime
server, Java dependency or JavaScript implementation of Petri semantics.

Petri and Catalog use the examples WASM adapter; Library uses the independently
built Text runtime through Toolkit. Browser runs accept up to 64 KiB each of
model and scenario text, 1,000 scenario inputs, a one-hour simulation horizon,
and unsigned 32-bit seeds. Runs retain the normal 1,000 steps-per-instant limit
and use 10,000 total-step/event budgets. The UI can cancel a worker and times out
long-running work; budget stops are shown in the outcome, not treated as success
at the requested horizon.

### Build and preview locally

Install Rust, Python 3, Node.js 22+ (for the WASM smoke check), and wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.14.0 --locked
npm --prefix toolkit ci
python -B tools/build_web.py
node tools/check_web.mjs
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000/`. Serve `dist/` over HTTP; opening `index.html`
directly cannot load the module worker. The build uses the pinned core revision,
so it requires the same core repository access as native builds. Generated WASM
and JavaScript stay in ignored `dist/pkg/`. The checked-in browser adapter is
[browser/src/lib.rs](browser/src/lib.rs), and the UI is in [web/](web/).
All asset paths are relative so the site also works under a GitHub project path.

### Publish the GitHub link

The [Browser examples workflow](.github/workflows/web.yml) builds and checks the
actual WASM binary on pushes to `develop` and pull requests, then uploads a
static Pages artifact. Publishing is an explicit workflow dispatch:

1. Configure repository **Settings â†’ Pages â†’ Source â†’ GitHub Actions**. For this
   private repository, confirm the organization's Pages plan and intended site
   visibility; Pages access is configured separately from repository access.
2. Configure `INTERSECT_CORE_TOKEN` with read access to the pinned private core,
   as for native CI. It is only used during the build and is not a site asset.
3. Run **Actions â†’ Browser examples â†’ Run workflow** on `develop`, with
   **Publish the tested playground to GitHub Pages** enabled. Allow `develop`
   in the `github-pages` environment's deployment rules.

The deployment job reports the live URL. The README link above is the standard
project URL; update it if the repository uses a custom domain. These source
changes alone do not enable Pages or publish the private repository's runtime.
See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

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
cargo clippy --all-targets -p examples-support -p examples-catalog -p examples-petri -p examples-library -p examples-run -p examples-web -- -D warnings
python -B tools/test_report.py run -- --profile test-fast -p examples-support -p examples-catalog -p examples-petri -p examples-library -p examples-run -p examples-web --lib --bins --tests
python -B tools/build_web.py
node tools/check_web.mjs
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
