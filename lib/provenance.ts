// Where a value came from, and whether a model may use it.
//
// Every context value carries one of three sources. "live" was measured or
// fetched for this user; "simulated" was made up (the developer simulator, a
// fallback); "missing" means there is no value. Calendar and wearable data used
// to be simulated and fed predictions without saying so.
//
// Models see live values only. Simulated values are treated as missing, so a
// feature built from them is left out rather than filled in. The one exception
// is development with SOMNIAI_SIMULATED_INPUTS=allow, so the simulator can
// still demonstrate predictions; production ignores that switch entirely.

export type Source = "live" | "simulated" | "missing";
export const SOURCES: readonly Source[] = ["live", "simulated", "missing"];

export type ContextGroup = "weather" | "calendar" | "wearable";
export type ContextSources = Record<ContextGroup, Source>;

export const NO_CONTEXT: ContextSources = { weather: "missing", calendar: "missing", wearable: "missing" };

/** May simulated values reach a model input here? Never in production. */
export function simulatedInputsAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.SOMNIAI_SIMULATED_INPUTS === "allow";
}

/** Whether a value from `source` may be used as a model input. */
export function usableForModels(source: Source | undefined, allowSimulated = simulatedInputsAllowed()): boolean {
  return source === "live" || (allowSimulated && source === "simulated");
}

/**
 * Mongo filters selecting records a model may learn from. Records written
 * before sources existed count as live, except the simulator's old
 * `meta.synthetic` events and "simulated" sleep logs.
 */
export function modelEventFilter(allowSimulated = simulatedInputsAllowed()): Record<string, unknown> {
  return allowSimulated ? {} : { source: { $ne: "simulated" }, "meta.synthetic": { $ne: true } };
}

export function modelSleepLogFilter(allowSimulated = simulatedInputsAllowed()): Record<string, unknown> {
  return allowSimulated ? {} : { source: { $ne: "simulated" } };
}

/** A snapshot's sources; snapshots written before sources existed have none, so nothing is usable. */
export function snapshotSources(snapshot: { sources?: Partial<ContextSources> } | null | undefined): ContextSources {
  const s = snapshot?.sources ?? {};
  const pick = (v: unknown): Source => (SOURCES.includes(v as Source) ? (v as Source) : "missing");
  return { weather: pick(s.weather), calendar: pick(s.calendar), wearable: pick(s.wearable) };
}
