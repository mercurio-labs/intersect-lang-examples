import { loadRuntime } from './runtime.js';

// One execution host retains Rust's aggregate four-job and encoded-byte limits.
// This worker owns no semantic implementation: every operation uses the WASM ABI.
const runtime = loadRuntime();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    let invoke;
    try {
      invoke = await runtime;
    } catch (error) {
      self.postMessage({ token: data.token, error: error.message, fatal: true });
      return;
    }
    try {
      self.postMessage({ token: data.token, response: invoke(data.request) });
    } catch (error) {
      self.postMessage({ token: data.token, error: error.message });
    }
  });
};
