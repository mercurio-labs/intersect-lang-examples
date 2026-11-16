# Intersect Toolkit

## Focused Model/Text alpha

The evaluation-alpha candidate builds two small browser examples:
Library and generic model/text editing. The alpha artifact uses the exact Text
revision in `runtime.json` and that revision's immutable Model dependency.
The pin selects Text's `v0.1.0-alpha.1` release source. Earlier preview downloads
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
harness, `Cargo.toml` and `Cargo.lock`. Extract the ZIP and run:

```sh
cargo run --release --locked
```

Rust 1.88 or newer is required. The first run downloads the pinned public
crates.io dependencies and builds the harness. The harness verifies the pack,
recompiles and verifies the retained language definitions, restores the complete
model snapshot, validates it and evaluates derived values. Results go to
`output/model.json`. Edit `src/main.rs` to add application-specific operations.
The pack is the runtime input; editing the reference source files alone does not
rebuild it. Recompile and export again from Toolkit to incorporate source changes.

Compile pending definition edits and fix model diagnostics before exporting.
The standalone runner supports self-contained Rcore/Xtext languages. External
Rhai implementations and host-specific conversion/setter providers require host
integration; Save project retains their definitions. **Export language ZIP** remains available for
the existing source/compiled-language distribution and optional Python wrappers.

`runner/` owns only the portable Toolkit pack recipe and example harness. It
uses the published Model/Text alpha crates. Model's existing native pack builder
produces the binary container in WASM; no second container or semantic engine
is implemented in JavaScript.
