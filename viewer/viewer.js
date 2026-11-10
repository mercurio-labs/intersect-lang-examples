"use strict";

const ui = Object.fromEntries(
  ["file", "layout", "status", "replay", "play", "step", "speed", "time", "clock",
    "net-panel", "net-title", "net", "chart", "legend", "events"].map(id => [id, document.getElementById(id)])
);
const colors = ["#68e0bd", "#8cafff", "#ffbd74", "#f796ba", "#c8b0ff", "#f6e08c"];
const names = {
  run_start: "Run start", event_delivered: "Event", input_rejected: "Rejected input",
  step_fired: "Fired", time_advanced: "Time advanced", run_end: "Run end",
};

function svg(tag, attrs = {}, label) {
  const element = document.createElementNS(ui.net.namespaceURI, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (label !== undefined) element.textContent = label;
  return element;
}

let trace;
let net;
let last;
let tick = 0;
let cursor = 0;
let animation = 0;
let previousFrame;
let layout;
let graph;
let chartCursor;
let rows = [];
let observations = [];

function relativeUrl(value) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) throw new Error("Use a relative JSON path.");
  const url = new URL(value, location.href);
  if (url.origin !== location.origin) throw new Error("Use a same-origin JSON path.");
  return url;
}

async function jsonAt(path) {
  const response = await fetch(relativeUrl(path), { mode: "same-origin" });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response.json();
}

function ticksToMs(ticks) {
  return ticks * trace.header.profile.nanos_per_tick / 1_000_000;
}

function install(data) {
  const entries = data?.entries;
  const profile = data?.header?.profile;
  if (data?.header?.format !== "intersect.run.trace.v1" ||
      !Number.isSafeInteger(profile?.nanos_per_tick) || profile.nanos_per_tick <= 0 ||
      !Array.isArray(entries) || !entries.length ||
      entries.some((entry, i) => !Number.isSafeInteger(entry?.time) || entry.time < 0 ||
        (i > 0 && entry.time < entries[i - 1].time) || !Object.hasOwn(names, entry.kind))) {
    throw new Error("Expected a version 1 run trace with ordered, safe integer ticks.");
  }
  pause();
  trace = data;
  net = profile.language_profile === "petri.timed-firing.v1" ? data.header.language_data : null;
  last = entries.at(-1).time;
  tick = 0;
  cursor = 0;
  layout = null;
  ui.time.max = last;
  ui.replay.hidden = false;
  ui["net-panel"].hidden = !net;
  ui.layout.disabled = !net;
  ui.status.textContent = `${profile.language_profile} · ${profile.policy} · ${entries.length} entries`;
  let snapshot;
  observations = entries.map(entry => {
    if (entry.observation) snapshot = entry.observation;
    return snapshot;
  });
  rows = entries.map(entry => {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = `${ticksToMs(entry.time)} ms`;
    const detail = document.createElement("span");
    detail.textContent = [names[entry.kind], entry.label].filter(Boolean).join(" · ");
    li.append(time, detail);
    return li;
  });
  const log = document.createDocumentFragment();
  for (const row of rows) log.append(row);
  ui.events.replaceChildren(log);
  if (net) {
    ui["net-title"].textContent = net.name;
    drawGraph();
    drawChart();
  }
  render();
}

function nodePosition(node, x, y) {
  const override = layout?.[node.id];
  return Number.isFinite(override?.x) && Number.isFinite(override?.y) ? override : { x, y };
}

function drawGraph() {
  const height = Math.max(210, 68 * Math.max(net.places.length, net.transitions.length) + 28);
  ui.net.setAttribute("viewBox", `0 0 500 ${height}`);
  const positions = new Map([
    ...net.places.map((place, i) => [place.id, nodePosition(place, 95, 42 + i * 68)]),
    ...net.transitions.map((transition, i) => [transition.id, nodePosition(transition, 385, 60 + i * 68)]),
  ]);
  const marker = svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
    markerWidth: 7, markerHeight: 7, orient: "auto" });
  marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#778ea3" }));
  const defs = svg("defs");
  defs.append(marker);
  ui.net.replaceChildren(defs);
  for (const transition of net.transitions) {
    const t = positions.get(transition.id);
    for (const [arcs, output] of [[transition.inputs, false], [transition.outputs, true]]) {
      for (const arc of arcs) {
        const p = positions.get(arc.place);
        if (!p) continue;
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const length = Math.hypot(dx, dy) || 1;
        const place = { x: p.x + 22 * dx / length, y: p.y + 22 * dy / length };
        const bar = { x: t.x - 9 * dx / length, y: t.y - 9 * dy / length };
        const [a, b] = output ? [bar, place] : [place, bar];
        const bend = output ? 22 : -22;
        const mx = (a.x + b.x) / 2 - bend * dy / length;
        const my = (a.y + b.y) / 2 + bend * dx / length;
        ui.net.append(svg("path", { d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`,
          class: "edge", "marker-end": "url(#arrow)" }));
        if (arc.weight !== 1) ui.net.append(svg("text", { x: mx, y: my, class: "weight" }, arc.weight));
      }
    }
  }
  graph = new Map();
  for (const place of net.places) {
    const { x, y } = positions.get(place.id);
    const count = svg("text", { x, y: y + 5, "text-anchor": "middle" });
    ui.net.append(svg("circle", { cx: x, cy: y, r: 21, class: "place" }), count,
      svg("text", { x: x - 28, y: y + 5, "text-anchor": "end" }, place.name));
    graph.set(place.id, { count });
  }
  for (const transition of net.transitions) {
    const { x, y } = positions.get(transition.id);
    const bar = svg("rect", { x: x - 8, y: y - 18, width: 16, height: 36, rx: 3, class: "transition" });
    const progress = svg("path", { class: "progress", "pathLength": 1 });
    progress.setAttribute("d", `M ${x - 10} ${y + 25} h 20`);
    ui.net.append(bar, progress, svg("text", { x: x + 14, y: y + 4 }, transition.name));
    graph.set(transition.id, { bar, progress });
  }
}

const chartX = at => 35 + 460 * at / Math.max(1, last);
function drawChart() {
  ui.chart.setAttribute("viewBox", "0 0 520 145");
  ui.chart.replaceChildren();
  ui.legend.replaceChildren();
  let max = 1;
  for (const snapshot of observations) {
    for (const value of Object.values(snapshot?.marking || {})) max = Math.max(max, value);
  }
  const y = value => 115 - 88 * value / max;
  for (const value of [0, max]) {
    ui.chart.append(svg("line", { x1: 35, x2: 495, y1: y(value), y2: y(value), class: "grid" }),
      svg("text", { x: 28, y: y(value) + 4, "text-anchor": "end" }, value));
  }
  ui.chart.append(svg("text", { x: 35, y: 137 }, "0 ms"),
    svg("text", { x: 495, y: 137, "text-anchor": "end" }, `${ticksToMs(last)} ms`));
  net.places.forEach((place, index) => {
    const color = colors[index % colors.length];
    const count = i => observations[i]?.marking?.[place.id] ?? 0;
    const path = trace.entries.slice(1).map((entry, i) => `H ${chartX(entry.time)} V ${y(count(i + 1))}`);
    ui.chart.append(svg("path", { d: `M 35 ${y(count(0))} ${path.join(" ")}`,
      stroke: color, class: "trace-line" }));
    const label = document.createElement("span");
    label.style.setProperty("--color", color);
    label.textContent = place.name;
    ui.legend.append(label);
  });
  chartCursor = svg("line", { y1: 22, y2: 118, class: "cursor" });
  ui.chart.append(chartCursor);
}

function render() {
  const entry = trace.entries[cursor];
  const snapshot = observations[cursor];
  const current = ui.events.querySelector("[aria-current=true]");
  if (current !== rows[cursor]) {
    current?.removeAttribute("aria-current");
    rows[cursor].setAttribute("aria-current", "true");
    ui.events.scrollTop = Math.max(0, rows[cursor].offsetTop - rows[0].offsetTop - 80);
  }
  ui.time.value = Math.floor(tick);
  ui.clock.textContent = `${Math.floor(ticksToMs(tick))} ms`;
  ui.step.disabled = cursor === trace.entries.length - 1;
  if (!net) return;
  chartCursor.setAttribute("x1", chartX(tick));
  chartCursor.setAttribute("x2", chartX(tick));
  const active = ["event_delivered", "step_fired"].includes(entry.kind) && snapshot?.action?.transition;
  for (const place of net.places) {
    graph.get(place.id).count.textContent = snapshot?.marking?.[place.id] ?? 0;
  }
  for (const transition of net.transitions) {
    const { bar, progress } = graph.get(transition.id);
    bar.classList.toggle("active", active === transition.id);
    const pending = Object.values(snapshot?.pending || {}).filter(item => item.transition === transition.id);
    const ratio = pending.reduce((max, item) => Math.max(max, (tick - item.started) / (item.due - item.started)), 0);
    progress.style.display = pending.length ? "" : "none";
    progress.setAttribute("stroke-dasharray", `${Math.min(1, ratio)} 1`);
  }
}

function seek(time) {
  tick = time;
  let lo = 0;
  let hi = trace.entries.length;
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (trace.entries[middle].time <= tick) lo = middle + 1;
    else hi = middle;
  }
  cursor = Math.max(0, lo - 1);
  render();
}

function pause() {
  cancelAnimationFrame(animation);
  animation = 0;
  previousFrame = undefined;
  ui.play.textContent = "Play";
}

function advance(now) {
  const elapsed = previousFrame === undefined ? 0 : now - previousFrame;
  previousFrame = now;
  const delta = elapsed * 1_000_000 * Number(ui.speed.value) / trace.header.profile.nanos_per_tick;
  seek(Math.min(last, tick + delta));
  if (tick < last) animation = requestAnimationFrame(advance);
  else pause();
}

ui.play.addEventListener("click", () => {
  if (animation) return pause();
  if (cursor === trace.entries.length - 1) {
    cursor = 0;
    tick = 0;
    render();
  }
  ui.play.textContent = "Pause";
  animation = requestAnimationFrame(advance);
});
ui.step.addEventListener("click", () => {
  pause();
  cursor = Math.min(cursor + 1, trace.entries.length - 1);
  tick = trace.entries[cursor].time;
  render();
});
ui.time.addEventListener("input", () => {
  pause();
  seek(Number(ui.time.value));
});

function showError(error) {
  ui.status.textContent = error.message;
}

ui.file.addEventListener("change", async () => {
  const file = ui.file.files[0];
  if (!file) return;
  try { install(JSON.parse(await file.text())); } catch (error) { showError(error); }
});
ui.layout.addEventListener("change", async () => {
  const file = ui.layout.files[0];
  if (!file || !net) return;
  try {
    layout = JSON.parse(await file.text());
    drawGraph();
    render();
  } catch (error) { showError(error); }
});

const query = new URLSearchParams(location.search);
if (query.has("trace")) {
  jsonAt(query.get("trace")).then(async data => {
    install(data);
    if (net && query.has("layout")) {
      layout = await jsonAt(query.get("layout"));
      drawGraph();
      render();
    }
  }).catch(showError);
}
