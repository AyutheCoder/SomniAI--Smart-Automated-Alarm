import type { ContextData } from "./types";
import { fetchWeather } from "./weather";

export * from "./types";
export { fetchWeather } from "./weather";

export interface BuildContextOptions {
  lat?: number;
  lon?: number;
}

/**
 * Context for one moment, with the source of every group: live, or missing.
 *
 * Weather is live when a location is given and the weather service answers;
 * otherwise it is missing, never made up. Calendar and wearable groups are
 * missing here: Google Calendar (4.1) and Health Connect (4.2) reach the
 * models through tasks and the sleep log instead. Made-up context exists only
 * on the developer simulator (lib/simulators, prompt 4.4).
 */
export async function buildContextData(opts: BuildContextOptions = {}): Promise<ContextData> {
  const data: ContextData = { sources: { weather: "missing", calendar: "missing", wearable: "missing" } };
  if (typeof opts.lat === "number" && typeof opts.lon === "number") {
    const weather = await fetchWeather(opts.lat, opts.lon);
    if (weather) {
      data.weather = weather;
      data.sources.weather = "live";
    }
  }
  return data;
}
