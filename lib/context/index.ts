import type { ContextData } from "./types";
import { fetchWeather, simulateWeather } from "./weather";
import { simulateCalendar } from "./calendar";
import { simulateWearable } from "./wearable";

export * from "./types";
export { fetchWeather, simulateWeather } from "./weather";
export { simulateCalendar } from "./calendar";
export { simulateWearable } from "./wearable";

export interface BuildContextOptions {
  /** Fill what isn't connected with made-up values, labelled simulated. */
  simulate?: boolean;
  lat?: number;
  lon?: number;
}

/**
 * Context for one moment, with the source of every group.
 *
 * Weather is live whenever a location is given, whatever `simulate` says; if
 * the weather service fails it is missing, never quietly simulated. Calendar
 * and wearable have no real connection yet (prompts 4.1 and 4.2), so they are
 * missing, or simulated when explicitly asked for.
 */
export async function buildContextData(opts: BuildContextOptions = {}): Promise<ContextData> {
  const hasLocation = typeof opts.lat === "number" && typeof opts.lon === "number";
  const data: ContextData = { sources: { weather: "missing", calendar: "missing", wearable: "missing" } };

  if (hasLocation) {
    const weather = await fetchWeather(opts.lat as number, opts.lon as number);
    if (weather) {
      data.weather = weather;
      data.sources.weather = "live";
    }
  }
  else if (opts.simulate) {
    data.weather = simulateWeather();
    data.sources.weather = "simulated";
  }

  if (opts.simulate) {
    data.calendar = simulateCalendar();
    data.sources.calendar = "simulated";
    data.wearable = simulateWearable();
    data.sources.wearable = "simulated";
  }
  return data;
}
