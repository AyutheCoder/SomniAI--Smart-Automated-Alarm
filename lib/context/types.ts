import type { ContextSources } from "@/lib/provenance";

export interface WeatherInfo {
  tempC: number;
  condition: string;
}

export interface CalendarEvent {
  title: string;
  start: string;
  importanceScore?: number;
}

export interface WearableInfo {
  restingHr?: number;
  steps?: number;
  lastSleepHours?: number;
}

/** Context as built: each group's values and, separately, where they came from. */
export interface ContextData {
  weather?: WeatherInfo;
  calendar?: CalendarEvent[];
  wearable?: WearableInfo;
  sources: ContextSources;
}