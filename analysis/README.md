# Pack-driven Intersect analysis

The native analysis host in this workspace uses `intersect-run` for execution,
the paired Model and Text runtime for authored languages, and the pinned KerML
evaluator for SysML.

## Build once, then build language packs

From the Intersect Examples repository root, with Python 3.11 or newer:

~~~sh
cargo fetch --locked --manifest-path analysis/Cargo.toml
python3 -B analysis/compiler_build.py -- build --locked --offline
runner=analysis/target/debug/intersect-analysis
language=analysis/examples/cistern
mkdir -p analysis/target/analysis-reports

"$runner" pack "$language/language.rcore" "$language/language.xtext" \
  "$language/analysis.json" analysis/target/cistern.pack
"$runner" check analysis/target/cistern.pack "$language/garden.cistern" \
  --report analysis/target/analysis-reports/cistern.json
~~~

The pack contains authored Rcore, Xtext and the version 1 execution mapping in
an Intersect language-pack container. The host recompiles the retained sources
with the NativeV62 Text profile at load and checks the mapping against the
resulting schema. The mapping names the subject, its contained analysis cases,
the quantities each case binds and the operation to run. Loading new packs
uses the same runner binary. The Allocation example exercises the same solver
with a different metamodel, grammar and set of cases.

The Garden model has four cases. Its operating-flow constraint passes, its
sizing result is 1.25 L/s, its sweep produces fill times of 5 s, 2.5 s and
1.25 s, and its trace shows one shutoff at 2.5 s with a final volume of 6 L.

## Run in CI

Run `check` as above, optionally with `--case Garden::fillTrace` for one
required case. Preserve the JSON report as a build artifact. Exit status 0
means all selected cases passed, 1 means a case failed or its model or analysis
had diagnostics, and 2 means a command, pack or file error. Diagnostic
locations are half-open byte ranges in the indicated resource.

Pin the runner build and pack input files. The report records SHA-256 digests
for the pack and model, the runner version, selected backend, typed bindings,
and check tolerance or simulation configuration. Simulations include the
versioned discrete-event trace.

## Run SysML

Build a SysML v2 pack with the same compiler as the analysis CLI. The first
build compiles both languages and prepares the standard library. To reuse
compatible parts of an earlier pack, add `--previous PATH`.

~~~sh
mkdir -p analysis/target
sysml_pack=analysis/target/sysml.pack
python3 -B analysis/compiler_build.py pack "$sysml_pack"

"$runner" sysml "$sysml_pack" analysis/examples/sysml/garden.sysml \
  --case CisternAnalysis::sizeInlet \
  --inputs analysis/examples/sysml/fill-in-four-seconds.json
"$runner" sysml "$sysml_pack" analysis/examples/sysml/garden.sysml \
  --case CisternAnalysis::sizeEmbedded --body-pack analysis/target/cistern.pack
~~~

Native sizing resolves the typed parameters in the selected analysis usage.
An input file binds parameters the SysML model leaves open. Embedded sizing
binds typed SysML parameters to the Cistern case and
maps diagnostics in the body to its original source range. Both use the
same scalar solver. The supported native shape is a named analysis usage
with one unbound scalar return and one inline asserted equality or foreign
representation. Explicit SysML objectives are outside this profile.

The first solver supports one affine unknown, scalar arithmetic and the
volume/time units used by Cistern. The continuous backend advances one volume
at constant rates across a one-shot rising threshold and schedules the crossing
through the discrete engine. Sample intervals affect the report, while
threshold timing is localized and recorded at nanosecond resolution.

## Verify

~~~sh
python3 -B analysis/compiler_build.py -- test --locked --offline
INTERSECT_SYSML_ANALYSIS_PACK="$sysml_pack" \
  python3 -B analysis/compiler_build.py -- test --locked --offline --test all -- --ignored
~~~
