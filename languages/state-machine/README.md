# State machine language

An editable, hierarchical state machine example for Intersect Text, Run, and
Views. The browser runs the same checked Rust model and execution profile as
the CLI in a WebAssembly worker.

## Browser harness

From this directory, use Node 22.15+, Python 3.11+, and the Rust version in
`rust-toolchain.toml`. If npm resolves GitHub Git dependencies over SSH, use your
GitHub SSH setup or this process-scoped Git transport override.

```sh
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=url.https://github.com/mercurio-labs/intersect-views.git.insteadOf
export GIT_CONFIG_VALUE_0=ssh://git@github.com/mercurio-labs/intersect-views.git
npm ci
npm run build
npm run preview
```

[Open the local simulator](http://127.0.0.1:1499/). **Step** through the Airlock
scenario or **Play** it at a fixed display cadence. Green highlights follow the
active composite and leaf. Amber marks the fired transition. Try `lock` while
`Open` is active to see a rejected event leave the active path intact. Select a
trace row to revisit that state. **Send** applies an event from the selected
step. **Reset** returns to the initial state.

Edit **Model source** and select **Load model** to try another machine.
Double-click a diagram symbol to find its declaration. **Download trace** saves
the Intersect Run JSON through the selected step.

## Language and profile

```text
machine Door initial Closed {
  event open;
  state Closed;
  state Open;
  transition Closed on open -> Open;
}
```

[The Xtext grammar](language/machine.xtext) and [Rcore metamodel](language/machine.rcore)
define the language. [Scope bindings](language/bindings.rcore) resolve transition
endpoints, events, and initial states. A composite declares an initial direct
child. Names are unique across a machine's states and unique across its events.
Each state may have one transition per event. The deepest matching active state
handles the event. Entering a composite automatically follows its initial
children.

[The Run profile](profiles/event-step.json) uses one ordered event per logical
tick. It records initial state, fired transitions, and rejected inputs. The
profile supports one active state path, up to four levels of nesting, 64 states,
64 event declarations, 256 transitions, and 256 input events.

## Native example and checks

```sh
cargo fetch --locked
python3 -B tools/compiler_build.py -- run --locked --offline > airlock.trace.json
python3 -B tools/compiler_build.py -- run --locked --offline -- models/airlock.machine unlock open jam
python3 -B tools/compiler_build.py --report -- test --locked --offline
npx playwright install chromium
npm run test:browser
```

The browser test serves the production build. It follows an actual WASM trace,
checks active symbol and transition highlights, and loads a second machine
authored in the browser.
