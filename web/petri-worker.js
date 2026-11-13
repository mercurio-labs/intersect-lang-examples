// This adapter delegates all language behavior to the shared Rust implementation.
import init, { run_petri, sample_model, sample_scenario } from "./pkg/examples_web.js";

try {
  await init();
  self.postMessage({ type: "ready", model: sample_model(), scenario: sample_scenario() });
} catch (error) {
  self.postMessage({ type: "error", message: `Could not initialize WebAssembly: ${error.message || error}` });
}

self.addEventListener("message", event => {
  const request = event.data;
  if (request?.type !== "run") return;
  try {
    const result = JSON.parse(run_petri(request.model, request.scenario,
      request.until_ms, request.policy, request.seed));
    self.postMessage({ type: "result", id: request.id, result });
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: String(error.message || error) });
  }
});
