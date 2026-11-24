import "@intersect/visualization/canvas.css";
import "./style.css";
import { DiagramCanvas } from "@intersect/visualization/canvas";
import { WorkerHost } from "@intersect/visualization/worker-host";
import { samplesFromTrace, type Comparison, type Configuration, type ThermalRun } from "./model";
import { notation, scene } from "./scene";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw Error(`Missing ${id}`);
  return element as T;
}

const power = byId<HTMLInputElement>("power");
const loss = byId<HTMLInputElement>("loss");
const time = byId<HTMLInputElement>("time");
const controls = { power, loss };
const method = byId<HTMLSelectElement>("method");
const reset = byId<HTMLButtonElement>("reset");
const download = byId<HTMLButtonElement>("trace-download");
const status = byId("run-status");
const host = new WorkerHost(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));

interface Series { run: ThermalRun; temperatures: number[] }
let configuration: Configuration | undefined;
let result: { report: Comparison; baseline: Series; current: Series } | undefined;
let revision = 0;
let acceptedRevision = -1;
let pending = false;
let timer = 0;

const chart = document.createElement("canvas");
chart.setAttribute("role", "img");
byId("chart").append(chart);
const context = chart.getContext("2d");
if (!context) throw Error("This browser cannot display the temperature chart");
const brush: CanvasRenderingContext2D = context;
const decimal = new Intl.NumberFormat("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const numeric = (value: number) => decimal.format(value);
const colors = { current: "#00766a", baseline: "#607583", target: "#9e6936", guide: "#a8bbb7" };
const inset = { left: 49, right: 22, top: 19, bottom: 37 };

function paint(enclosure: Configuration, baseline: Series, current: Series, minutes: number, sampleIndex: number) {
  const width = chart.clientWidth, height = chart.clientHeight;
  if (width <= inset.left + inset.right || height <= inset.top + inset.bottom) return;
  const pixelRatio = window.devicePixelRatio || 1;
  chart.width = Math.round(width * pixelRatio);
  chart.height = Math.round(height * pixelRatio);
  brush.scale(pixelRatio, pixelRatio);
  brush.font = "12px system-ui";
  const plotHeight = height - inset.bottom - inset.top;
  const plotWidth = width - inset.left - inset.right;
  const baselineEnd = Math.max(...baseline.temperatures);
  const currentEnd = Math.max(...current.temperatures);
  const low = enclosure.initial - 5;
  const high = Math.max(baselineEnd, currentEnd, enclosure.target + 5);
  const interval = Math.ceil((high - low) / 5 / 5) * 5;
  const ceiling = low + 5 * interval;
  const x = (value: number) => inset.left + value / enclosure.duration * plotWidth;
  const y = (value: number) => height - inset.bottom - (value - low) / (ceiling - low) * plotHeight;

  const line = (a: number, b: number, c: number, d: number, color: string, dash: number[] = []) => {
    brush.beginPath();
    brush.strokeStyle = color;
    brush.lineWidth = 1;
    brush.setLineDash(dash);
    brush.moveTo(a, b);
    brush.lineTo(c, d);
    brush.stroke();
  };
  brush.textAlign = "right";
  brush.textBaseline = "middle";
  brush.fillStyle = "#405a5d";
  for (let tick = low; tick <= ceiling; tick += interval) {
    line(x(0), y(tick), x(enclosure.duration), y(tick), "#dfebe7");
    brush.fillText(`${tick}°`, inset.left - 9, y(tick));
  }
  brush.textAlign = "center";
  brush.textBaseline = "top";
  const minuteInterval = width < 475 ? 10 : 5;
  for (let tick = 0; tick <= enclosure.duration; tick += minuteInterval) {
    brush.fillText(`${tick} min`, x(tick), height - inset.bottom + 12);
  }
  line(x(0), y(enclosure.target), x(enclosure.duration), y(enclosure.target), colors.target, [2, 4]);
  line(x(minutes), inset.top, x(minutes), height - inset.bottom, colors.guide);
  const curve = ({ temperatures }: Series, color: string, dash: number[]) => {
    brush.beginPath();
    brush.lineWidth = dash.length ? 2 : 3;
    brush.strokeStyle = color;
    brush.setLineDash(dash);
    for (const [index, temperature] of temperatures.entries()) {
      const tx = x(index * enclosure.sampleSeconds / 60), ty = y(temperature);
      if (index === 0) brush.moveTo(tx, ty);
      else brush.lineTo(tx, ty);
    }
    brush.stroke();
  };
  curve(current, colors.current, []);
  curve(baseline, colors.baseline, [4, 6]);
  for (const [series, color] of [[baseline, colors.baseline], [current, colors.current]] as const) {
    brush.beginPath();
    brush.fillStyle = color;
    brush.arc(x(minutes), y(series.temperatures[sampleIndex]), 4.7, 0, 2 * Math.PI);
    brush.fill();
  }
}

function render() {
  if (!configuration || !result) return;
  const { duration, sampleSeconds } = configuration;
  const { baseline, current } = result;
  const minutes = time.valueAsNumber;
  const sampleIndex = Math.round(minutes * 60 / sampleSeconds);
  const measured = current.temperatures[sampleIndex];
  const difference = measured - baseline.temperatures[sampleIndex];
  const { equilibrium, targetSeconds, targetReachable } = current.run.summary;
  byId("time-value").textContent = `${minutes} min`;
  byId("reading-title").textContent = `Temperature at ${minutes} min`;
  byId("reading").textContent = `${numeric(measured)} °C`;
  byId("difference").textContent = `${difference >= 0.05 ? "+" : ""}${numeric(Math.abs(difference) < 0.05 ? 0 : difference)} °C`;
  byId("target").textContent = targetSeconds !== null
    ? `${numeric(targetSeconds / 60)} min`
    : targetReachable ? `After ${duration} min` : "Unreachable";
  byId("equilibrium").textContent = equilibrium.kind === "solved"
    ? `${numeric(equilibrium.celsius)} °C`
    : equilibrium.kind === "underdetermined" ? "Underdetermined" : "No finite solution";
  chart.setAttribute("aria-label", `Current and baseline temperature over ${duration} minutes. At ${minutes} minutes: ${numeric(measured)} degrees Celsius.`);
  paint(configuration, baseline, current, minutes, sampleIndex);
}

async function run() {
  if (!configuration || pending) return;
  const model = configuration;
  const requestRevision = revision;
  pending = true;
  try {
    const report = await host.request<Comparison>("thermal/compare", {
      method: method.value, current: { power: power.valueAsNumber, loss: loss.valueAsNumber },
    });
    if (revision !== requestRevision) return;
    const getSeries = (id: string): Series => {
      const run = report.cases.find(({ case: runCase }) => runCase.id === id);
      if (!run) throw Error(`Missing ${id} case in Run response`);
      return { run, temperatures: samplesFromTrace(run.trace, model) };
    };
    result = { report, baseline: getSeries("baseline"), current: getSeries("current") };
    render();
    acceptedRevision = requestRevision;
    status.textContent = `Intersect Run · ${result.current.temperatures.length} samples per case`;
    download.disabled = false;
  } catch (error) {
    if (revision === requestRevision)
      status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    pending = false;
    if (revision !== requestRevision) queueRun();
  }
}

function queueRun() {
  byId("power-value").textContent = `${power.valueAsNumber} W`;
  byId("loss-value").textContent = `${loss.valueAsNumber} W/°C`;
  status.textContent = "Running both cases…";
  download.disabled = true;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), 36);
}

function requestRun() {
  revision++;
  queueRun();
}

async function initialize() {
  try {
    configuration = await host.request<Configuration>("thermal/config", {});
    const { baseline, ambient, initial, heatCapacity, duration, limits, equationSource } = configuration;
    byId("equation-source").textContent = equationSource;
    for (const name of ["power", "loss"] as const) {
      const control = controls[name];
      const { min, max, step } = limits[name];
      control.min = String(min);
      control.max = String(max);
      control.step = String(step);
      control.valueAsNumber = baseline[name];
      control.addEventListener("input", requestRun);
    }
    byId("ambient").textContent = ambient === initial ? `${ambient} °C` : `${ambient} / ${initial} °C`;
    byId("capacity").textContent = `${heatCapacity.toLocaleString("en")} J/°C`;
    byId("baseline-inputs").textContent = `${baseline.power} W · ${baseline.loss} W/°C`;
    time.max = String(duration);
    for (const control of [method, power, loss, time, reset]) control.disabled = false;
    requestRun();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

method.addEventListener("change", requestRun);
time.addEventListener("input", render);
reset.addEventListener("click", () => {
  if (!configuration) return;
  power.valueAsNumber = configuration.baseline.power;
  loss.valueAsNumber = configuration.baseline.loss;
  time.valueAsNumber = 10;
  requestRun();
});
chart.addEventListener("click", (event) => {
  if (!configuration || !result) return;
  const proportion = (event.offsetX - inset.left) / (chart.clientWidth - inset.left - inset.right);
  if (Number.isFinite(proportion)) {
    const duration = configuration.duration;
    time.valueAsNumber = Math.min(duration, Math.max(0, Math.round(proportion * duration * 2) / 2));
    render();
  }
});
download.addEventListener("click", () => {
  if (!result || acceptedRevision !== revision) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result.report, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "heated-enclosure.run.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
new ResizeObserver(render).observe(chart);
void initialize();

const diagram = new DiagramCanvas(byId("diagram"), {
  view() {},
  select({ elementId }, reveal) {
    if (reveal && (elementId === "power" || elementId === "loss")) controls[elementId].focus();
  },
  async command() {},
  presentationWritable: () => false,
  presentation() {},
  save() {},
  palette() {},
  undo() {},
});
diagram.setNotation(notation);
diagram.views([scene.scene.view], scene.scene.view.key);
diagram.setScene(scene);
