import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [wasmPath, binaryPath, playwrightPath] = process.argv.slice(2);
if (!wasmPath || !binaryPath) {
  throw new Error("Usage: node tools/package-parity.mjs ENGINE.wasm NATIVE_BINARY [PLAYWRIGHT_INDEX.mjs]");
}
const fixtures = fileURLToPath(new URL("../qualification/", import.meta.url));
const native = resolve(binaryPath);
const wasm = readFileSync(wasmPath);
const temporary = mkdtempSync(join(tmpdir(), "intersect-package-parity-"));

function command(args, expectedError) {
  const result = spawnSync(native, args, { encoding: "utf8", maxBuffer: 8 << 20 });
  if (result.error) throw result.error;
  if (expectedError) {
    assert.notEqual(result.status, 0, `${args[0]} unexpectedly succeeded`);
    assert.match(result.stderr, expectedError);
  } else {
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
  }
  return result.stdout;
}

function packageFixture(name, folder = join(fixtures, name)) {
  const path = join(temporary, `${name}.pack.json`);
  command(["pack", join(folder, "language.toml"), path]);
  const archive = JSON.parse(readFileSync(path, "utf8"));
  const manifest = JSON.parse(archive["manifest.json"]);
  assert.equal(manifest.format_version, 3);
  for (const { source } of Object.values(manifest.execution.profiles)) {
    assert(manifest.files[source]?.sha256, `Missing digest for ${source}`);
    assert.doesNotMatch(archive[source], /^pub fn engine\(/m);
  }
  return { path, archive, manifest };
}

function modelRequest(packageName, file) {
  return { model: { sources: [{ uri: file, text: readFileSync(join(fixtures, packageName, "models", file), "utf8") }] } };
}

// This function is shared by the Node check and the Chromium worker.
async function createTransport(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { execute, input_buffer, memory, output_buffer } = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (message) => {
    const input = encoder.encode(JSON.stringify(message));
    const pointer = input_buffer(input.length);
    if (!pointer) throw new Error(`WASM input refused ${input.length} bytes`);
    new Uint8Array(memory.buffer, pointer, input.length).set(input);
    const length = execute();
    return JSON.parse(decoder.decode(new Uint8Array(memory.buffer, output_buffer(), length)));
  };
}

async function startBrowser() {
  if (!playwrightPath) return undefined;
  const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.evaluate(async ({ wasmBase64, transport }) => {
      const source = `
        const createTransport = ${transport};
        let run;
        onmessage = async ({ data }) => {
          try {
            if (!run) {
              run = await createTransport(data);
              postMessage({ ready: true });
            } else {
              postMessage({ result: run(data) });
            }
          } catch (error) {
            postMessage({ failure: String(error) });
          }
        };
      `;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const worker = new Worker(url);
      const dispatch = (data, transfer = []) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.failure ? reject(new Error(data.failure)) : resolve(data);
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(data, transfer);
      });
      try {
        const bytes = Uint8Array.from(atob(wasmBase64), (value) => value.charCodeAt(0));
        const initialized = await dispatch(bytes, [bytes.buffer]);
        if (!initialized.ready) throw new Error("WASM worker failed to initialize");
        globalThis.runPack = async (message) => (await dispatch(message)).result;
      } finally {
        URL.revokeObjectURL(url);
      }
    }, { wasmBase64: wasm.toString("base64"), transport: createTransport.toString() });
    return {
      run: (message) => page.evaluate((message) => globalThis.runPack(message), message),
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

let browser;
try {
  const runWasm = await createTransport(wasm);
  browser = await startBrowser();
  const hosts = browser ? "native, Node WASM, Chromium worker" : "native and Node WASM";

  async function compare(name, pack, request) {
    const requestPath = join(temporary, `${name}.request.json`);
    writeFileSync(requestPath, JSON.stringify(request));
    const expected = JSON.parse(command(["run", pack.path, requestPath]));
    const checked = JSON.parse(command(["check", pack.path, requestPath]));
    assert.deepEqual(checked, { provenance: expected.provenance }, `${name}: check and run provenance`);

    const profile = request.profile ?? pack.manifest.execution.default;
    const { engine, source } = pack.manifest.execution.profiles[profile];
    const { model_sha256: modelDigest, inputs_sha256: inputsDigest } = expected.provenance;
    assert.match(modelDigest, /^[0-9a-f]{64}$/);
    assert.match(inputsDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(expected.provenance, {
      package: pack.manifest.metadata.package_id,
      archive_revision: pack.manifest.revision,
      schema_revision: pack.manifest.schema_revision,
      engine,
      profile,
      source,
      profile_source_sha256: createHash("sha256").update(pack.archive[source]).digest("hex"),
      model_sha256: modelDigest,
      inputs_sha256: inputsDigest,
    }, `${name}: resolved package and profile identities`);
    assert.equal(expected.provenance.profile_source_sha256, pack.manifest.files[source].sha256);
    for (const { trace } of expected.cases) {
      assert.equal(trace.header.model_digest, modelDigest);
    }

    const message = { archive: pack.archive, request };
    assert.deepEqual(runWasm(message), expected, `${name}: Node WASM`);
    if (browser) assert.deepEqual(await browser.run(message), expected, `${name}: Chromium worker`);
    console.log(`${name}: matching full package run across ${hosts}`);
    return expected;
  }

  async function reject(name, pack, request, pattern) {
    const requestPath = join(temporary, `${name}.request.json`);
    writeFileSync(requestPath, JSON.stringify(request));
    command(["check", pack.path, requestPath], pattern);
    const message = { archive: pack.archive, request };
    assert.match(runWasm(message).error, pattern, `${name}: Node WASM`);
    if (browser) assert.match((await browser.run(message)).error, pattern, `${name}: Chromium worker`);
    console.log(`${name}: refused across ${hosts}`);
  }

  const airlock = packageFixture("airlock");
  assert.equal(airlock.manifest.execution.default, "timeline");
  assert.deepEqual(Object.keys(airlock.manifest.execution.profiles).sort(), ["timeline", "user-events"]);
  const airlockRequest = modelRequest("airlock", "airlock.machine");
  const standard = await compare("Airlock default", airlock, airlockRequest);
  assert.equal(standard.cases.length, 1);
  const airlockTrace = standard.cases[0].trace;
  assert.equal(airlockTrace.header.profile.language_profile, "intersect.state-machine@1");
  const frames = airlockTrace.entries.filter(({ kind }) =>
    ["run_start", "step_fired", "input_rejected"].includes(kind));
  assert.deepEqual(frames.map(({ time }) => time), [0, 1, 2, 3, 4, 5, 6]);
  const [sealed, accessReady, accessOpen, rejected, closed, fault, recovered] =
    frames.map(({ observation }) => observation.active);
  assert.deepEqual([sealed.length, accessReady.length, accessOpen.length, fault.length], [1, 2, 2, 1]);
  assert.equal(new Set([...sealed, ...accessReady, accessOpen[1], ...fault]).size, 5);
  assert.equal(accessReady[0], accessOpen[0]);
  assert.deepEqual(rejected, accessOpen);
  assert.deepEqual(closed, accessReady);
  assert.deepEqual(recovered, sealed);
  assert.equal(frames[3].kind, "input_rejected");
  assert.match(frames[3].label, /^lock:/);
  assert.deepEqual(frames.filter(({ kind }) => kind === "step_fired")
    .map(({ observation }) => observation.transition),
  [12, 13, 14, 16, 17].map((index) => `airlock.machine#${index}`));

  const userEvents = await compare("Airlock selected profile", airlock, {
    ...airlockRequest,
    profile: "user-events",
    inputs: { events: [{ at: 10, event: "unlock" }] },
  });
  assert.equal(userEvents.provenance.profile, "user-events");
  assert.equal(userEvents.provenance.model_sha256, standard.provenance.model_sha256);
  assert.notEqual(userEvents.provenance.inputs_sha256, standard.provenance.inputs_sha256);
  assert.deepEqual(userEvents.cases[0].trace.entries
    .filter(({ kind }) => kind === "step_fired")
    .map(({ time, observation }) => [time, observation.active]), [[10, accessReady]]);

  const simultaneous = {
    ...airlockRequest,
    profile: "user-events",
    inputs: { events: [{ at: 10, event: "unlock" }, { at: 10, event: "unlock" }] },
  };
  await reject("Simultaneous deferred chart events", airlock, simultaneous, /need distinct ticks/i);

  const thermostat = packageFixture("thermostat");
  const thermostatRequest = {
    ...modelRequest("thermostat", "cabin.enclosure"),
    inputs: { parameters: { current: { power: 200 } } },
  };

  function checkThermostat(result, initial, upper) {
    assert.deepEqual(result.cases.map((item) => item.case), ["baseline", "current"]);
    for (const [index, { trace }] of result.cases.entries()) {
      const power = index === 0 ? 120 : 200;
      assert.equal(trace.header.profile.language_profile, "intersect.coupled-ode@1");
      const samples = trace.entries.filter(({ observation }) => observation?.sample);
      assert.deepEqual(samples.map(({ time }) => time), Array.from({ length: 121 }, (_, i) => i * 15_000));
      assert.equal(samples[0].observation.values.temperatureC, initial);
      const crossings = trace.entries.filter(({ observation }) => observation?.crossed.length);
      assert(crossings.length > 2);
      const first = crossings[0];
      const equilibrium = 20 + power / 5;
      const crossingSeconds = -240 * Math.log((equilibrium - upper) / (equilibrium - initial));
      assert(Math.abs(first.time / 1000 - crossingSeconds) < 0.0011,
        `Expected first crossing at ${crossingSeconds}s, got ${first.time}ms`);
      for (const [index, { observation }] of crossings.entries()) {
        const heating = index % 2 === 1;
        assert.deepEqual(observation.crossed, [heating ? "tooCool" : "tooHot"]);
        assert.equal(observation.mode, heating ? "Heating" : "Idle");
        assert(Math.abs(observation.values.temperatureC - (heating ? 38 : upper)) < 0.0002);
      }
    }
  }
  const controlled = await compare("Thermostat model and override", thermostat, thermostatRequest);
  checkThermostat(controlled, 20, 40);
  const edited = structuredClone(thermostatRequest);
  edited.model.sources[0].text = edited.model.sources[0].text.replace("enclosure Cabin", "enclosure Cabin warm");
  const changed = await compare("Thermostat edited model", thermostat, edited);
  checkThermostat(changed, 21, 41);
  assert.equal(changed.provenance.archive_revision, controlled.provenance.archive_revision);
  assert.equal(changed.provenance.inputs_sha256, controlled.provenance.inputs_sha256);
  assert.notEqual(changed.provenance.model_sha256, controlled.provenance.model_sha256);

  await reject("Unknown profile", airlock, { ...airlockRequest, profile: "missing" }, /profile.*missing|missing.*profile/i);
  const tampered = {
    path: join(temporary, "tampered.pack.json"),
    archive: { ...airlock.archive, "execution/airlock.rcore": `${airlock.archive["execution/airlock.rcore"]}\n` },
  };
  writeFileSync(tampered.path, JSON.stringify(tampered.archive));
  await reject("Changed packed source", tampered, airlockRequest, /digest mismatch/i);

  const invalidFolder = join(temporary, "invalid-thermostat");
  cpSync(join(fixtures, "thermostat"), invalidFolder, { recursive: true });
  const invalidPath = join(invalidFolder, "execution/thermostat.rcore");
  writeFileSync(invalidPath, readFileSync(invalidPath, "utf8").replace("active.Heating", "active.Missing"));
  const invalid = packageFixture("invalid-thermostat", invalidFolder);
  assert.equal(invalid.manifest.schema_revision, thermostat.manifest.schema_revision);
  assert.notEqual(invalid.manifest.revision, thermostat.manifest.revision);
  await reject("Unresolved engine state binding", invalid, thermostatRequest, /active\.Missing|unknown.*state/i);

  const editingOnly = join(temporary, "editing-only");
  cpSync(join(fixtures, "airlock"), editingOnly, { recursive: true });
  const editingManifest = join(editingOnly, "language.toml");
  writeFileSync(editingManifest, readFileSync(editingManifest, "utf8").split("[execution]")[0]);
  const editingPack = { path: join(temporary, "editing-only.pack.json") };
  command(["pack", editingManifest, editingPack.path]);
  editingPack.archive = JSON.parse(readFileSync(editingPack.path, "utf8"));
  const legacy = JSON.parse(editingPack.archive["manifest.json"]);
  assert.equal(legacy.format_version, 2);
  assert(!Object.hasOwn(legacy, "execution"));
  assert.equal(legacy.schema_revision, airlock.manifest.schema_revision);
  assert.deepEqual(JSON.parse(command(["inspect", editingPack.path])), legacy);
  await reject("Language without an execution profile", editingPack, airlockRequest, /no execution profiles/i);

  const unsupportedFolder = join(temporary, "unsupported-engine");
  cpSync(join(fixtures, "airlock"), unsupportedFolder, { recursive: true });
  const unsupportedManifest = join(unsupportedFolder, "language.toml");
  writeFileSync(unsupportedManifest, readFileSync(unsupportedManifest, "utf8")
    .replace("intersect.state-machine@1", "intersect.state-machine@99"));
  command(["pack", unsupportedManifest, join(temporary, "unsupported.pack.json")], /state-machine@99/i);
  console.log("Unsupported engine version: refused during packaging");
} finally {
  try {
    await browser?.close();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
