import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(await readFile("web/generated/thermal.wasm"));
const wasm = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function browserRun(method, power, loss) {
  const bytes = encoder.encode(JSON.stringify({
    method: "thermal/compare", params: { method, current: { power, loss } },
  }));
  const pointer = wasm.input_buffer(bytes.length);
  assert(pointer);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  const length = wasm.execute();
  return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length)));
}

function same(expected, actual, path = "comparison") {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", path);
    assert(Math.abs(expected - actual) <= 1e-9, `${path}: ${expected} vs ${actual}`);
  } else if (expected && typeof expected === "object") {
    assert(actual && typeof actual === "object", path);
    assert.deepEqual(Object.keys(expected).sort(), Object.keys(actual).sort(), path);
    for (const key of Object.keys(expected)) same(expected[key], actual[key], `${path}.${key}`);
  } else {
    assert.equal(expected, actual, path);
  }
}

for (const method of ["analytic", "ode"]) {
  for (const [power, loss] of [[250, 5], [120, 0], [120, 15], [0, 0]]) {
    const native = JSON.parse(execFileSync("cargo", [
      "run", "--quiet", "--locked", "--", method, String(power), String(loss),
    ], { encoding: "utf8" }));
    const browser = browserRun(method, power, loss);
    assert.equal(browser.cases?.length, 2, JSON.stringify(browser));
    same(native, browser);
  }
}
console.log("Native and browser WASM agree for every trace entry in eight profile/input combinations.");
