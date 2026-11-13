// Exercise the shipped WASM binary, not a JavaScript simulation or a native stub.
// Node's ESM loader is sufficient; no browser automation packages are required.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import init, { run_petri, sample_model, sample_scenario, catalog_samples, check_catalog, stopwatch_sources, run_stopwatch } from "../dist/pkg/examples_web.js";

await init({ module_or_path: await readFile(new URL("../dist/pkg/examples_web_bg.wasm", import.meta.url)) });
const run = (model, scenario = '{"inputs":[]}', policy = "first", seed = 0) =>
  JSON.parse(run_petri(model, scenario, 20_000, policy, seed));
const coffee = run(sample_model(), sample_scenario());
const golden = JSON.parse(await readFile(new URL("../languages/petri/tests/golden/coffee.trace.json", import.meta.url)));
assert.deepEqual(coffee.trace.entries, golden.entries);
assert.equal(coffee.summary.time_ms, 6000);
assert.equal(coffee.summary.marking.find(place => place.name === "cups").tokens, 2);
const invalid = await readFile(new URL("../languages/petri/models/invalid-weight.petri", import.meta.url), "utf8");
const rejected = run(invalid);
assert.equal(rejected.trace, null);
assert.ok(rejected.diagnostics.some(issue => issue.resource === "coffee.petri" && issue.span));
assert.throws(() => run(sample_model(), "not json"));
assert.throws(() => run("not a net"));
const conflict = await readFile(new URL("../languages/petri/models/conflict.petri", import.meta.url), "utf8");
assert.deepEqual(run(conflict, '{"inputs":[]}', "seeded", 7), run(conflict, '{"inputs":[]}', "seeded", 7));
const zeno = await readFile(new URL("../languages/petri/models/zeno.petri", import.meta.url), "utf8");
assert.equal(run(zeno).summary.reason, "StepsPerInstant");
console.log("WASM: coffee matches native trace; diagnostics, malformed inputs, seeded replay and cycle budget pass.");
const samples = JSON.parse(catalog_samples());
const catalog = JSON.parse(check_catalog(...samples));
assert.equal(catalog.objects.reduce((n,o)=>n+o.links.length,0),9);
assert.throws(()=>check_catalog(samples[0], 'not a catalog'));
console.log('WASM: Catalog resolves all nine references across two resources and rejects invalid source.');
const stopwatch=JSON.parse(run_stopwatch(JSON.parse(stopwatch_sources()).text));
assert.equal(stopwatch.summary.elapsed_ms,2750);
assert.equal(stopwatch.summary.time_ms,3250);
assert.equal(stopwatch.summary.state,'stopped');
assert.ok(stopwatch.machine.transitions.some(t=>t.from==='idle' && t.command==='start' && t.to==='running'));
console.log('WASM: Stopwatch executes Rcore transitions and excludes stopped time from Run timing.');
