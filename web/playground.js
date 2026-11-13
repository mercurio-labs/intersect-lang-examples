const ui = Object.fromEntries([
  "run-form", "model", "scenario", "until", "policy", "seed", "run", "cancel",
  "reset-sample", "restart", "status", "diagnostics-panel", "diagnostics", "download",
  "empty-result", "summary", "replay",
].map(id => [id, document.getElementById(id)]));

let worker;
let ready = false;
let sample;
let requestId = 0;
let activeId;
let watchdog;
let lastTrace;
let viewerReady = false;

function status(message, kind = "") {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

function busy(value) {
  ui.run.disabled = value || !ready;
  ui.cancel.hidden = !value;
  ui["run-form"].setAttribute("aria-busy", String(value));
  ui["reset-sample"].disabled = value || !sample;
  ui.model.readOnly = value;
  ui.scenario.readOnly = value;
  ui.until.disabled = value;
  ui.policy.disabled = value;
  ui.seed.disabled = value || ui.policy.value !== "seeded";
}

function clearResult() {
  lastTrace = undefined;
  ui.download.disabled = true;
  ui.summary.hidden = true;
  ui.replay.hidden = true;
  ui["empty-result"].hidden = false;
  ui["diagnostics-panel"].hidden = true;
  ui.diagnostics.replaceChildren();
  if (viewerReady) ui.replay.contentWindow.postMessage({ type: "intersect:clear" }, location.origin);
}

function stopWorker(message) {
  clearTimeout(watchdog);
  worker?.terminate();
  worker = undefined;
  ready = false;
  activeId = undefined;
  busy(false);
  ui.restart.hidden = false;
  status(message, "error");
}

function showDiagnostics(diagnostics = []) {
  ui.diagnostics.replaceChildren(...diagnostics.map(diagnostic => {
    const item = document.createElement("li");
    const span = Array.isArray(diagnostic.span) ? ` bytes ${diagnostic.span.join("–")}` : "";
    const location = diagnostic.resource ? `${diagnostic.resource}${span}: ` : "";
    item.textContent = `${location}${diagnostic.code}: ${diagnostic.message}`;
    return item;
  }));
  ui["diagnostics-panel"].hidden = !diagnostics.length;
}

function sendTrace() {
  if (viewerReady && lastTrace) {
    ui.replay.contentWindow.postMessage({ type: "intersect:trace", trace: lastTrace }, location.origin);
  }
}

function showResult(result) {
  showDiagnostics(result.diagnostics);
  if (!result.trace) {
    status("Validation found errors. Update the model and run again.", "error");
    return;
  }
  lastTrace = result.trace;
  const { reason, time_ms, steps, marking } = result.summary;
  const reasons = { Quiescence: "No more events", EndTime: "End time reached",
    StepsPerInstant: "Instant step limit reached", TotalSteps: "Total step limit reached", Events: "Event limit reached" };
  const labels = [`${reasons[reason] || reason} · ${time_ms.toLocaleString()} ms · ${steps.toLocaleString()} ${steps === 1 ? "step" : "steps"}`,
    ...marking.map(place => `${place.name}: ${place.tokens.toLocaleString()}`)];
  ui.summary.replaceChildren(...labels.map(label => {
    const element = document.createElement("span");
    element.textContent = label;
    return element;
  }));
  ui.summary.hidden = false;
  ui["empty-result"].hidden = true;
  ui.replay.hidden = false;
  ui.download.disabled = false;
  const limited = ["StepsPerInstant", "TotalSteps", "Events"].includes(reason);
  status(limited ? "Run stopped at its execution limit. Replay the recorded steps below."
    : "Run complete. Play the trace or step through each event below.", limited ? "error" : "success");
  sendTrace();
}

function startWorker() {
  worker?.terminate();
  clearTimeout(watchdog);
  ready = false;
  activeId = undefined;
  busy(false);
  ui.restart.hidden = true;
  status("Loading the WebAssembly engine…");
  try {
    worker = new Worker(new URL("petri-worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    stopWorker(`Could not start the engine: ${error.message}. Serve the built site over HTTP or HTTPS.`);
    return;
  }
  watchdog = setTimeout(() => stopWorker("The engine took too long to load. Reload it to try again."), 60_000);
  const instance = worker;
  worker.addEventListener("error", event => {
    if (worker !== instance) return;
    event.preventDefault();
    stopWorker(`The engine could not continue: ${event.message || "WebAssembly loading failed"}. Reload it to try again.`);
  });
  worker.addEventListener("message", event => {
    if (worker !== instance) return;
    const message = event.data;
    if (message.type === "ready") {
      clearTimeout(watchdog);
      ready = true;
      sample = { model: message.model, scenario: message.scenario };
      if (!ui.model.value && !ui.scenario.value) {
        ui.model.value = sample.model;
        ui.scenario.value = sample.scenario;
      }
      busy(false);
      status("Engine ready. Run the coffee example or edit it first.");
    } else if (message.type === "error" && message.id === undefined) {
      stopWorker(message.message);
    } else if (message.id === activeId && activeId !== undefined) {
      clearTimeout(watchdog);
      activeId = undefined;
      busy(false);
      if (message.type === "error") status(message.message, "error");
      else if (message.type === "result") {
        try { showResult(message.result); }
        catch (error) { clearResult(); status(`Could not display the result: ${error.message}`, "error"); }
      }
    }
  });
}

ui["run-form"].addEventListener("submit", event => {
  event.preventDefault();
  if (!ready || activeId !== undefined || !ui["run-form"].reportValidity()) return;
  clearResult();
  if (!ui.model.value.trim()) return status("Enter a Petri model first.", "error");
  const until = Number(ui.until.value);
  const seed = ui.policy.value === "first" ? 0 : Number(ui.seed.value);
  if (![until, seed].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295)) {
    return status("Run until and seed must be whole numbers from 0 to 4,294,967,295.", "error");
  }
  if (until > 3_600_000) return status("Run until must be at most 3,600,000 ms (one hour).", "error");
  try { JSON.parse(ui.scenario.value); }
  catch (error) { return status(`Scenario JSON: ${error.message}`, "error"); }
  activeId = ++requestId;
  busy(true);
  status("Parsing, linking, validating, and simulating…");
  watchdog = setTimeout(() => stopWorker("The run exceeded 30 seconds and was stopped. Simplify the model or reload the engine to try again."), 30_000);
  worker.postMessage({ type: "run", id: activeId, model: ui.model.value,
    scenario: ui.scenario.value, until_ms: until, policy: ui.policy.value, seed });
});

ui.policy.addEventListener("change", () => { ui.seed.disabled = ui.policy.value !== "seeded"; });
ui["run-form"].addEventListener("input", () => {
  if (lastTrace) status("Inputs changed. Run again to update the trace below.");
});
ui.cancel.addEventListener("click", () => stopWorker("Run cancelled. Your edits are preserved. Reload the engine when ready."));
ui.restart.addEventListener("click", startWorker);
ui["reset-sample"].addEventListener("click", () => {
  if (!sample) return;
  ui.model.value = sample.model;
  ui.scenario.value = sample.scenario;
  ui.until.value = "20000";
  ui.policy.value = "first";
  ui.seed.value = "0";
  ui.seed.disabled = true;
  clearResult();
  status("Coffee example restored. Run it when ready.");
});

ui.download.addEventListener("click", () => {
  if (!lastTrace) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastTrace, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "petri.trace.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== ui.replay.contentWindow) return;
  if (event.data?.type === "intersect:viewer-ready") {
    viewerReady = true;
    sendTrace();
  } else if (event.data?.type === "intersect:viewer-error") {
    status(`Trace replay: ${event.data.message}`, "error");
  }
});

ui.replay.addEventListener("load", () => {
  viewerReady = false;
  ui.replay.contentWindow.postMessage({ type: "intersect:viewer-ping" }, location.origin);
});
// Also covers a cached iframe that finished loading before this module ran.
ui.replay.contentWindow.postMessage({ type: "intersect:viewer-ping" }, location.origin);

window.addEventListener("pagehide", () => { worker?.terminate(); clearTimeout(watchdog); });
window.addEventListener("pageshow", event => {
  if (event.persisted) startWorker();
});
startWorker();
