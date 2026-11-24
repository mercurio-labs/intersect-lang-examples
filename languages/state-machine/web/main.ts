import "@intersect/visualization/canvas.css";
import "./style.css";
import { DiagramCanvas } from "@intersect/visualization/canvas";
import { WorkerHost } from "@intersect/visualization/worker-host";
import type { GraphScene, NotationProfile, Position, SceneResponse } from "@intersect/visualization";
import sample from "../models/airlock.machine?raw";
import scenario from "../models/airlock.events.json";

interface Active { id: string; name: string }
interface Frame {
  tick: number;
  event: string | null;
  active: Active[];
  outcome: "initial" | "transition" | "rejected";
  transition: string | null;
  message: string | null;
}
interface Execution { frames: Frame[]; trace: unknown }
interface Loaded {
  name: string;
  events: string[];
  scene: Omit<SceneResponse, "scene"> & { scene: GraphScene };
  notation: NotationProfile;
  initial: Frame;
}

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw Error(`Missing control ${id}`);
  return result as T;
}

const diagram = element("diagram");
const source = element<HTMLTextAreaElement>("source");
const input = element<HTMLTextAreaElement>("scenario");
const eventPicker = element<HTMLSelectElement>("event");
const compile = element<HTMLButtonElement>("compile");
const step = element<HTMLButtonElement>("step");
const play = element<HTMLButtonElement>("play");
const reset = element<HTMLButtonElement>("reset");
const send = element<HTMLButtonElement>("send");
const download = element<HTMLButtonElement>("download");
const history = element<HTMLOListElement>("history");
const status = element("run-status");
const sourceStatus = element("source-status");
const host = new WorkerHost(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));

source.value = sample;
input.value = scenario.join(", ");
let loaded: Loaded | undefined;
let execution: Execution | undefined;
let cursor = 0;
let revealedThrough = 0;
let scenarioKey: string | undefined;
let busy = false;
let playing = false;
let playTimer: number | undefined;
let revision = 0;
let nodeElements = new Map<string, string>();
let edgeElements = new Map<string, string>();

function offset(position: Position) {
  const lines = source.value.split("\n");
  return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
}

const canvas = new DiagramCanvas(diagram, {
  view() {},
  select(binding, reveal) {
    if (!reveal || !loaded) return;
    source.focus({ preventScroll: true });
    source.setSelectionRange(offset(binding.range.start), offset(binding.range.end));
  },
  async command() {},
  presentation() {},
  presentationWritable: () => false,
  save() {},
  palette() {},
  undo() {},
});
diagram.classList.add("simulation");

function current(): Frame | undefined {
  return execution?.frames[cursor] ?? loaded?.initial;
}

function paint() {
  const frame = current();
  const active = new Set(frame?.active.map(({ id }) => id));
  const leaf = frame?.active.at(-1)?.id;
  for (const node of diagram.querySelectorAll<SVGElement>(".diagram-node")) {
    const id = nodeElements.get(node.dataset.symbol ?? "");
    node.classList.toggle("execution-active", id !== undefined && active.has(id));
    node.classList.toggle("execution-leaf", id !== undefined && id === leaf);
  }
  for (const edge of diagram.querySelectorAll<SVGElement>(".diagram-edge"))
    edge.classList.toggle("execution-fired", !!frame?.transition && edgeElements.get(edge.dataset.edge ?? "") === frame.transition);
}
new MutationObserver(paint).observe(diagram, { subtree: true, childList: true });

function inputs() {
  return input.value.split(/[,\s]+/).filter(Boolean);
}

function controls() {
  const available = !!loaded && !busy;
  const runnable = available && inputs().length > 0 &&
    (scenarioKey !== input.value || cursor < (execution?.frames.length ?? 1) - 1);
  compile.disabled = busy;
  step.disabled = !runnable || playing;
  play.disabled = !playing && !runnable;
  play.textContent = playing ? "Pause" : "Play";
  reset.disabled = !available;
  eventPicker.disabled = !available || playing || eventPicker.options.length === 0;
  send.disabled = eventPicker.disabled;
  download.disabled = !available || playing || cursor === 0;
  for (const button of history.querySelectorAll("button")) button.disabled = busy || playing;
}

function render() {
  const frame = current();
  element("active-state").textContent = frame?.active.map(({ name }) => name).join(" › ") ?? "No active state";
  element("step-count").textContent = `Step ${cursor}`;
  if (frame) {
    status.textContent = frame.outcome === "initial"
      ? "Ready for an event."
      : frame.outcome === "rejected"
        ? frame.message ?? "Event rejected."
        : `${frame.event} → ${frame.active.at(-1)?.name}`;
    status.dataset.outcome = frame.outcome;
  }
  history.replaceChildren();
  const frames = execution?.frames ?? (loaded ? [loaded.initial] : []);
  for (const [index, data] of frames.slice(0, revealedThrough + 1).entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = document.createElement("strong");
    const active = document.createElement("span");
    button.type = "button";
    button.disabled = busy || playing;
    button.setAttribute("aria-current", index === cursor ? "step" : "false");
    button.dataset.outcome = data.outcome;
    label.textContent = index === 0 ? "Initial" : `${index}. ${data.event}${data.outcome === "rejected" ? " · rejected" : ""}`;
    active.textContent = data.active.map(({ name }) => name).join(" › ");
    button.append(label, active);
    button.onclick = () => { cursor = index; render(); };
    item.append(button);
    history.append(item);
  }
  paint();
  controls();
}

function cancelPlayback() {
  playing = false;
  window.clearTimeout(playTimer);
}

function clearRun() {
  execution = undefined;
  cursor = 0;
  revealedThrough = 0;
  scenarioKey = undefined;
}

async function load() {
  cancelPlayback();
  const generation = ++revision;
  loaded = undefined;
  clearRun();
  busy = true;
  canvas.setStale();
  sourceStatus.textContent = "Checking source…";
  status.textContent = "Loading model…";
  render();
  try {
    const next = await host.request<Loaded>("machine/load", { source: source.value });
    if (generation !== revision) return;
    canvas.reset({ schemaVersion: 5, views: {} });
    canvas.setNotation(next.notation);
    canvas.views([next.scene.scene.view], next.scene.scene.view.key);
    canvas.setScene(next.scene);
    await canvas.whenReady();
    if (generation !== revision) return;
    loaded = next;
    const nodes = new Map<string, string>();
    const collect = (list: GraphScene["nodes"]) => {
      for (const node of list) {
        nodes.set(node.id, node.binding.elementId);
        collect(node.children);
      }
    };
    collect(next.scene.scene.nodes);
    nodeElements = nodes;
    edgeElements = new Map(next.scene.scene.edges.map((edge) => [edge.id, edge.binding.elementId]));
    element("diagram-title").textContent = next.name;
    eventPicker.replaceChildren(...next.events.map((name) => new Option(name, name)));
    sourceStatus.textContent = "Model loaded.";
  } catch (error) {
    if (generation !== revision) return;
    sourceStatus.textContent = error instanceof Error ? error.message : String(error);
    status.textContent = "Fix the model source and load it again.";
  } finally {
    busy = false;
    render();
  }
}

function prefix() {
  return execution?.frames.slice(1, cursor + 1).flatMap((frame) => frame.event ? [frame.event] : []) ?? [];
}

async function run(action: () => Promise<void>) {
  busy = true;
  controls();
  try {
    await action();
    render();
  } catch (error) {
    cancelPlayback();
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.outcome = "rejected";
  } finally {
    busy = false;
    controls();
  }
}

async function advance() {
  const generation = revision;
  await run(async () => {
    if (scenarioKey !== input.value || !execution) {
      const text = input.value;
      const next = await host.request<Execution>("machine/run", { events: inputs() });
      if (generation !== revision || text !== input.value) return;
      execution = next;
      cursor = 0;
      revealedThrough = 0;
      scenarioKey = text;
    }
    if (cursor < execution.frames.length - 1) cursor++;
    revealedThrough = Math.max(revealedThrough, cursor);
  });
}

async function playback() {
  if (!playing) return;
  await advance();
  if (!playing || cursor === (execution?.frames.length ?? 1) - 1) {
    cancelPlayback();
    render();
    return;
  }
  playTimer = window.setTimeout(() => void playback(), 650);
}

compile.onclick = () => void load();
source.addEventListener("input", () => {
  ++revision;
  cancelPlayback();
  clearRun();
  loaded = undefined;
  canvas.setStale();
  sourceStatus.textContent = "Source edited. Load the model to run this version.";
  status.textContent = "Execution paused for source changes.";
  render();
});
input.addEventListener("input", () => {
  cancelPlayback();
  controls();
});
step.onclick = () => void advance();
play.onclick = () => {
  if (playing) {
    cancelPlayback();
    render();
  } else {
    playing = true;
    render();
    void playback();
  }
};
reset.onclick = () => {
  cancelPlayback();
  clearRun();
  render();
};
element<HTMLFormElement>("send-form").onsubmit = (event) => {
  event.preventDefault();
  const generation = revision;
  const events = [...prefix(), eventPicker.value];
  void run(async () => {
    const next = await host.request<Execution>("machine/run", { events });
    if (generation !== revision) return;
    execution = next;
    cursor = next.frames.length - 1;
    revealedThrough = cursor;
    scenarioKey = undefined;
  });
};
download.onclick = () => {
  const events = prefix();
  void run(async () => {
    const result = await host.request<Execution>("machine/run", { events });
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.trace, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "state-machine.trace.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
};
void load();
