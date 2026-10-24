import { afterEach, describe, expect, it, vi } from "vitest";
import {
  modelEventFilter,
  modelSleepLogFilter,
  simulatedInputsAllowed,
  snapshotSources,
  usableForModels,
} from "./provenance";
import { buildContextData } from "./context";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("simulated values and models", () => {
  it.each([
    ["production, even with the switch on", { NODE_ENV: "production", SOMNIAI_SIMULATED_INPUTS: "allow" }, false],
    ["production", { NODE_ENV: "production" }, false],
    ["development by default", { NODE_ENV: "development" }, false],
    ["tests by default", { NODE_ENV: "test" }, false],
    ["development with a different value", { NODE_ENV: "development", SOMNIAI_SIMULATED_INPUTS: "yes" }, false],
    ["development with the switch on", { NODE_ENV: "development", SOMNIAI_SIMULATED_INPUTS: "allow" }, true],
  ])("are allowed in %s: %s", (_where, env, allowed) => {
    expect(simulatedInputsAllowed(env)).toBe(allowed);
  });

  it("only live values are usable unless simulated ones are explicitly allowed", () => {
    expect(usableForModels("live", false)).toBe(true);
    expect(usableForModels("simulated", false)).toBe(false);
    expect(usableForModels("missing", false)).toBe(false);
    expect(usableForModels(undefined, false)).toBe(false);
    expect(usableForModels("simulated", true)).toBe(true);
    expect(usableForModels("missing", true)).toBe(false);
  });

  it("filters simulated and old synthetic records out of model queries", () => {
    expect(modelEventFilter(false)).toEqual({ source: { $ne: "simulated" }, "meta.synthetic": { $ne: true } });
    expect(modelSleepLogFilter(false)).toEqual({ source: { $ne: "simulated" } });
    expect(modelEventFilter(true)).toEqual({});
  });

  it("treats a snapshot from before sources existed as having no live values", () => {
    expect(snapshotSources({})).toEqual({ weather: "missing", calendar: "missing", wearable: "missing" });
    expect(snapshotSources(null)).toEqual({ weather: "missing", calendar: "missing", wearable: "missing" });
    expect(snapshotSources({ sources: { wearable: "bogus" as never, weather: "live" } }))
      .toEqual({ weather: "live", calendar: "missing", wearable: "missing" });
  });
});

const weatherReply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("buildContextData", () => {
  it("with nothing connected, reports every group missing and makes nothing up", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const data = await buildContextData();
    expect(data).toEqual({ sources: { weather: "missing", calendar: "missing", wearable: "missing" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses live weather by default when a location is given", async () => {
    vi.stubGlobal("fetch", weatherReply({ current: { temperature_2m: 21.4, weather_code: 0 } }));
    const data = await buildContextData({ lat: 28.6, lon: 77.2 });
    expect(data.weather).toEqual({ tempC: 21.4, condition: "Clear" });
    expect(data.sources).toEqual({ weather: "live", calendar: "missing", wearable: "missing" });
  });

  it("keeps weather live with a location even when simulating the rest", async () => {
    vi.stubGlobal("fetch", weatherReply({ current: { temperature_2m: 30, weather_code: 63 } }));
    const data = await buildContextData({ simulate: true, lat: 28.6, lon: 77.2 });
    expect(data.sources).toEqual({ weather: "live", calendar: "simulated", wearable: "simulated" });
    expect(data.weather).toEqual({ tempC: 30, condition: "Rain" });
  });

  it.each([
    ["the service errors", () => weatherReply({ error: "down" }, 503)],
    ["the reply is malformed", () => weatherReply({ current: {} })],
    ["the network fails", () => vi.fn(async () => { throw new TypeError("fetch failed"); })],
  ])("reports weather missing, not simulated, when %s", async (_why, make) => {
    vi.stubGlobal("fetch", make());
    const data = await buildContextData({ lat: 28.6, lon: 77.2 });
    expect(data.sources.weather).toBe("missing");
    expect(data.weather).toBeUndefined();
  });

  it("labels every made-up group simulated when asked to simulate", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const data = await buildContextData({ simulate: true });
    expect(data.sources).toEqual({ weather: "simulated", calendar: "simulated", wearable: "simulated" });
    expect(data.wearable?.restingHr).toEqual(expect.any(Number));
  });
});
