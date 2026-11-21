# Intersect Toolkit

## Focused Model/Text alpha

The evaluation-alpha candidate builds two small browser examples:
Library and generic model/text editing. The alpha artifact uses the exact Text
revision in `runtime.json` and that revision's immutable Model dependency.
The pin selects the Text source candidate for `v0.1.0-alpha.2`. Earlier preview downloads
retain their original inputs and qualification scope.
The root gallery still uses the older combined repository and is outside this
candidate's qualification. No release is published by these commands.

```sh
cd toolkit
npm ci
npm run build:alpha
python -m http.server 8000 --bind 127.0.0.1 --directory alpha-dist
```

Open http://127.0.0.1:8000/. The output is a standalone static site: distribute
the whole `alpha-dist` directory, including licenses, notice inventory and
provenance. It needs an HTTP server, not a build checkout, to run. Build tools
are Node 22.15+, Python 3.11+, Git, the runtime's pinned Rust toolchain and its
`wasm32-unknown-unknown` target. Building requires access to the pinned sources
and package dependencies. Rust distribution license files must be installed.
Custom `INTERSECT_WEB_WASM` overrides are rejected for alpha builds.

The alpha build excludes Monaco, Python and the full workbench. Library edits
objects and references across resources; the generic editor demonstrates
selected language profiles, preserving edits and verified text generation.
History is in memory. Retain authored source by copying it; neither editor has
a project save/open interface. Source reconstruction tests do not imply project
persistence or cross-alpha compatibility.

To qualify an extracted artifact, serve it at the URL root and run:

```sh
npm run test:standalone
# Set INTERSECT_ALPHA_URL=http://127.0.0.1:8000/ in your shell first.
npm run test:alpha
```

Install Chromium with `npx playwright install chromium` if needed. Tests use
the supplied HTTP server; they neither build the runtime nor start a development
server. The suite checks edits, references, invalid-input recovery, undo/redo,
generation, local asset loading and reconstruction in a fresh browser context.
It does not qualify the historical gallery or full Toolkit project workflows.
For hosting under a prefix, rebuild with an absolute `TOOLKIT_BASE` ending in
`/`; the root-relative qualification suite targets the default `/` build.

## Full workbench development

The browser application and its browser/Node tests live in this repository.
It consumes Intersect Text's WASM host, native test oracles and fixture corpus
from the exact Git revision in `runtime.json`. `scripts/prepare-runtime.mjs`
fetches that source into ignored `.runtime/intersect-text/`; no sibling checkout
or workspace path patch is used. Text and Model are public repositories; the
browser runs entirely from the built static assets.

```sh
cd toolkit
npm ci
npm run build
npm run preview -- --port 4173 --strictPort
```

Install Node 22.15+, Git, Rust and `rustup target add wasm32-unknown-unknown`.
Open http://127.0.0.1:4173/library-text.html for synchronized model/text editing,
or http://127.0.0.1:4173/ for the full language workbench. `npm run dev` also
prepares the runtime. `INTERSECT_WEB_WASM` can select a compatible custom host;
fixtures and native oracles still use the recorded revision.

```sh
npm run test:standalone
npm run test:rhai-editor
npx playwright install chromium
npm test -- tests/library-text.spec.js tests/model-text.spec.js
```

The focused browser tests check edits in both directions, reference updates,
source/comment preservation, invalid drafts, and undo/redo through actual WASM.
The full historical browser and Node qualification suites remain available via
the existing scripts; some build native oracles and take substantially longer.
Test fixture paths and oracle working directories resolve inside the pinned
cache. Do not point them at a sibling development checkout.

For publication, set `TOOLKIT_BASE` to the served path (the site builder sets
`/intersect-lang-examples/toolkit/` on Pages). `python -B tools/build_web.py` from
the repository root builds the gallery, Petri/Catalog WASM and Toolkit together.
Update `runtime.json` deliberately when adopting a new Text revision; the pin
also selects Text's Cargo.lock and its immutable Model dependencies.

The public workbench is hosted at
[intersect-lang-examples/toolkit/](https://mercurio-labs.github.io/intersect-lang-examples/toolkit/).
The Browser examples workflow deploys the verified artifact from `main`, including
checks at the GitHub Pages project prefix and a full Monaco/workbench startup.

## Explorer, language helpers and runnable downloads

The workbench follows Mercurio's light/dark palette and three-pane layout.
Use the explorer's **Model / Files** tabs to switch between containment and
project files. Click a file to open its existing editor. Right-click in the
explorer and choose **New File…**, or use its **+** button, to create a model
file, Python script or query. New files are included in **File → Save project**.
Starter examples are under **File → Starter projects**.

The Rcore and Xtext source editors have contextual, collapsible syntax guides.
The Rcore guide covers metamodels, classes, features, multiplicities, references,
enums and operation contracts, with a link to the full language reference.

**File → Download ready-to-run ZIP** exports the current valid model together
with its compiled language in a native `model.pack` container. The ZIP includes
authored definitions, model sources, the saved Toolkit project, a small Rust
harness, `Cargo.toml` and `Cargo.lock`. The README and two short examples start
with the tasks the code is for:

```sh
cargo run --release --locked -- load model.pack
cargo run --release --locked -- inspect model.pack
cargo run --release --locked -- unpack existing.pack editable
cargo run --release --locked -- build editable/project.json rebuilt.pack
cargo run --release --locked -- load rebuilt.pack
```

Rust 1.88 or newer is required. The first run downloads the pinned public
crates.io dependencies and builds the program. `load` restores the saved model,
validates it and evaluates derived values; results go to `output/model.json`.
No arguments still loads the included `model.pack`.

`project.json` maps editable files under `definitions/` and `models/` to their
original source URIs. `build` recompiles those files using the retained language
settings, parses and validates the model, then writes a new pack. Compilation
or validation failures preserve an existing output pack. `unpack` extracts the
same editable project from an existing Toolkit pack into an empty folder.
`inspect` also describes other recipes supported by the native container reader;
loading their semantics requires the owning language's loader.

`examples/load_pack.rs` and `examples/build_pack.rs` demonstrate the application
API in a few lines. `src/main.rs` provides the four commands. Support modules
own file I/O, source identity refresh and the native container recipe; the
downloaded Rust project contains no WASM host code or browser build features.
The original Toolkit project, when present, is under `toolkit/`.

Compile pending definition edits and fix model diagnostics before exporting.
The standalone runner supports self-contained Rcore/Xtext languages. External
Rhai implementations and host-specific conversion/setter providers require host
integration; Save project retains their definitions. **Export language ZIP** remains available for
the existing source/compiled-language distribution and optional Python wrappers.

`runner/` owns only the portable Toolkit pack recipe and example harness. It
uses the published Model/Text alpha crates. Model's existing native pack builder
produces the binary container in WASM; no second container or semantic engine
is implemented in JavaScript.

For milestone qualification of a downloaded Library fixture, run
`python -B tools/verify_runner_workflows.py --project target/runner-export/extracted --target-dir toolkit/runner/target`.
It checks loading, source/definition edits, rebuilding, unpacking, failure preservation,
pack corruption and the two short examples. The Pages deployment runs this check.
