import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [wasmPath, nativePath] = process.argv.slice(2);
if (!wasmPath || !nativePath) {
  throw new Error("Usage: node tools/wasm-parity.mjs ENGINE.wasm NATIVE_BINARY");
}
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const { execute, input_buffer, memory, output_buffer } = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function run(uri, source) {
  const input = encoder.encode(JSON.stringify({ uri, source }));
  const pointer = input_buffer(input.length);
  assert(pointer);
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const length = execute();
  const output = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, output_buffer(), length)));
  assert(!output.error, output.error);
  return output;
}

for (const name of ["airlock", "stopwatch", "coffee", "conflict-seeded", "zeno",
                    "heated-enclosure", "thermostat", "oscillator", "service-desk", "tank-level"]) {
  const path = `profiles/${name}.rcore`;
  const source = readFileSync(path, "utf8");
  const native = JSON.parse(execFileSync(nativePath, [path], { encoding: "utf8", maxBuffer: 8 << 20 }));
  assert.deepEqual(run(path, source), native, name);
  console.log(`${name}: matching native and WASM traces`);
}

const spring = readFileSync("profiles/oscillator.rcore", "utf8");
const original = run("memory:spring.rcore", spring);
const edited = run("memory:spring.rcore", spring.replace("frequency: 1.0", "frequency: 2.0"));
assert.notDeepEqual(original[0].trace.entries, edited[0].trace.entries);
console.log("Edited runtime source executed in the same WASM instance");
