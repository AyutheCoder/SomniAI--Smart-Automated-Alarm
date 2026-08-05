import type { ContextData } from "./types";
import { fetchWeather, simulateWeather } from "./weather";
import { simulateCalendar } from "./calendar";
import { simulateWearable } from "./wearable";

export * from "./types";
export { fetchWeather, simulateWeather } from "./weather";
export { simulateCalendar } from "./calendar";
export { simulateWearable } from "./wearable";

export interface BuildContextOptions {
  simulate?: boolean;
  lat?: number;
  lon?: number;
}

export async function buildContextData(opts: BuildContextOptions = {}): Promise<ContextData> {
  const useLive = !opts.simulate && typeof opts.lat === "number" && typeof opts.lon === "number";
  const weather = useLive
    ? await fetchWeather(opts.lat as number, opts.lon as number)
    : simulateWeather();
  return {
    weather,
    calendar: simulateCalendar(),
    wearable: simulateWearable(),
  };
}