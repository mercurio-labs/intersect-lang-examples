// Browser-facing profile and trace shapes. Equations and solver work live in WASM.
export interface Parameters {
  power: number;
  loss: number;
}

export interface Configuration {
  equationSource: string;
  ambient: number;
  initial: number;
  heatCapacity: number;
  duration: number;
  target: number;
  sampleSeconds: number;
  baseline: Parameters;
  limits: Record<keyof Parameters, { min: number; max: number; step: number }>;
}

export interface RunTrace {
  header: { format: string; profile: { nanos_per_tick: number } };
  entries: { kind: string; time: number; observation?: { temperatureC?: number } }[];
}

export interface ThermalRun {
  case: { id: string; parameters: Parameters };
  trace: RunTrace;
  summary: {
    targetSeconds: number | null;
    targetReachable: boolean;
    equilibrium: { kind: "solved"; celsius: number } | { kind: "no_finite_solution" | "underdetermined" };
  };
}

export interface Comparison { cases: ThermalRun[] }

export function samplesFromTrace(trace: RunTrace, configuration: Configuration): number[] {
  if (trace.header.format !== "intersect.run.trace.v1" || trace.header.profile.nanos_per_tick !== 1_000_000_000)
    throw Error("Unsupported thermal Run trace");
  const samples: number[] = [];
  for (const entry of trace.entries) {
    if (entry.kind !== "run_start" && entry.kind !== "event_delivered") continue;
    const temperature = entry.observation?.temperatureC;
    if (entry.time !== samples.length * configuration.sampleSeconds ||
        typeof temperature !== "number" || !Number.isFinite(temperature))
      throw Error("Thermal Run trace has an invalid sample");
    samples.push(temperature);
  }
  if (samples.length !== configuration.duration * 60 / configuration.sampleSeconds + 1)
    throw Error("Thermal Run trace is incomplete");
  return samples;
}
