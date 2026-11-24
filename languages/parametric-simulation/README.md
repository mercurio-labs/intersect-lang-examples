# Parametric simulation with Intersect Run

The heated-enclosure view compares a fixed baseline and an editable case.
Intersect Run executes both cases and records 121 temperature observations per
case, from zero through 30 minutes at 15-second intervals. The browser reads
these observations and uses the Views SDK to display the parameter dependencies.

**ODE** integrates `C dT/dt = P − k(T − Ta)` with fixed-step RK4.
**Analytic reference** evaluates the closed-form solution at the same logical
times. Both profiles find steady state with scalar bisection on
`P − k(T − Ta) = 0`. A zero heat-loss case reports either no finite equilibrium
or an underdetermined equilibrium, depending on heater power. The displayed
time to 40 °C is interpolated between scheduled samples.

The model is one well-mixed thermal mass, with constant inputs, initial and
ambient temperatures of 20 °C, and thermal capacity of 1,200 J/°C.
[thermal.rcore](language/thermal.rcore) defines the heat balance, ODE derivative,
decay exponent, and closed-form temperature equation. The CLI and browser
compile the same source and evaluate its typed Float64 functions with the
Intersect Model VM. The Rust adapter supplies the `expm1` primitive for the
analytic reference and validates the inputs. Expand **Rcore equations** in the
view to inspect the source.

Run owns case execution, time, and traces. Downloaded JSON contains the named
cases, input values, Run profiles, solver controls, outcomes, and standard
traces with the equation source digest.

## Build the preview

Use Node.js 22.15+ and the Rust toolchain in `rust-toolchain.toml`.
The build uses the exact Model and Views revisions recorded in the lockfiles.

```sh
npm ci
cargo fetch --locked
npm run build
npm run preview
```

Open [the simulation preview](http://127.0.0.1:1502/), vary power or heat loss,
and switch profiles. Scrubbing reads samples from the accepted Run traces.
The CLI uses the same profile and output format as the downloaded result.

```sh
cargo run --locked -- ode 250 5
cargo run --locked -- analytic 250 5
npm test
npm run test:parity
npx playwright install chromium
npm run test:browser
```

The parity check compares native and browser WASM reports for both profiles,
including zero loss, an unreachable target, and zero power.
