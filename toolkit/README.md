# Intersect Toolkit

The browser application and its browser/Node tests live in this repository.
It consumes Intersect Text's WASM host, native test oracles and fixture corpus
from the exact Git revision in `runtime.json`. `scripts/prepare-runtime.mjs`
fetches that source into ignored `.runtime/intersect-text/`; no sibling checkout
or workspace path patch is used. Git access to the private Text and Model
repositories is required on the build machine, not in the browser.

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
