import { defaultNotation, type Binding, type Label, type GraphScene, type Node, type SceneResponse, type NotationProfile } from "@intersect/visualization";

const entries = [
  ["power", "Heater power", "Input · W"],
  ["loss", "Heat loss", "Input · W/°C"],
  ["balance", "Thermal balance", "C dT/dt = P − k(T − Ta)"],
  ["temperature", "Temperature", "Output · °C"],
] as const;
const binding = (key: string): Binding => ({
  key, elementId: key, context: [], uri: "urn:intersect:example:thermal-enclosure", readOnly: true,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

const label = (id: string, slot: string, text: string): Label => ({
  parts: [{ id: id + "." + slot, text, binding: binding(id), editTool: null }],
});

const nodes: Node[] = entries.map(([id, title, subtitle]) => ({
  id, rule: id, styleClass: "", notation: id, title: label(id, "title", title),
  subtitle: label(id, "subtitle", subtitle), binding: binding(id),
  graphic: null, text: {}, expand: [], collapsed: false, compartments: [], children: [], regions: null, ports: [],
}));

const edges: GraphScene["edges"] = [
  ["heater", "power", "balance"], ["conduction", "loss", "balance"], ["response", "balance", "temperature"],
].map(([id, source, target]) => ({
  id, source, target, rule: id, styleClass: "", notation: "dependency", label: { parts: [] },
  branchGroup: null, binding: binding(id), text: {}, startMarker: null, endMarker: null,
}));

export const scene: SceneResponse & { scene: GraphScene } = {
  presentation: { fingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", libraries: [] },
  capabilities: [],
  scene: {
    schemaVersion: 7, form: "graph", revision: 1, ruleSet: "enclosure.thermal",
    layout: { strategy: "layered", direction: "RIGHT" },
    routing: { algorithm: "orthogonal", clearance: 8, stubLength: 18, trunks: "none" },
    endpointProxies: [], nodes, edges, problems: [],
    view: { key: "heat-flow", name: "Parameter dependencies", kind: "enclosure.thermal", binding: binding("heat-flow"), owners: [], details: [], problems: [] },
    palette: { schemaVersion: 1, id: "enclosure.thermal.palette", label: "Parametric view", groups: [] },
  },
};

export const notation: NotationProfile = {
  ...defaultNotation,
  id: "enclosure.thermal.notation",
  shapes: {
    ...defaultNotation.shapes,
    power: { shape: "rounded", stroke: "#68848c", fill: "#edf5f5", radius: 10 },
    loss: { shape: "rounded", stroke: "#68848c", fill: "#edf5f5", radius: 10 },
    balance: { shape: "rounded", stroke: "#947349", fill: "#f9efe0", radius: 10 },
    temperature: { shape: "rounded", stroke: "#007c72", fill: "#ddf1e9", radius: 10 },
  },
  edges: { ...defaultNotation.edges, dependency: { line: "solid", stroke: "#607c84", startMarker: "none", endMarker: "arrow" } },
};
