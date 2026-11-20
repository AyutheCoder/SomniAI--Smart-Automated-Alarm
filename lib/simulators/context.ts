// Made-up context for the developer simulator only (prompt 4.4). Nothing in a
// production code path may import this folder: tests/simulator-guard.test.ts
// fails if anything does, and the only importers are *.dev.ts(x) files, which
// a production build doesn't contain (next.config.ts).

import type { CalendarEvent, ContextData, WearableInfo, WeatherInfo } from "@/lib/context/types";

const SIM_CONDITIONS = ["Clear", "Partly cloudy", "Overcast", "Light rain", "Fog"];

export function simulateWeather(): WeatherInfo {
  return {
    tempC: Math.round((10 + Math.random() * 20) * 10) / 10,
    condition: SIM_CONDITIONS[Math.floor(Math.random() * SIM_CONDITIONS.length)],
  };
}

export function simulateWearable(): WearableInfo {
  return {
    restingHr: 52 + Math.floor(Math.random() * 20),
    steps: Math.floor(Math.random() * 12000),
    lastSleepHours: Math.round((5 + Math.random() * 4) * 10) / 10,
  };
}

const SAMPLE_EVENTS: Array<{
  title: string;
  importanceScore: number;
  hour: number;
}> = [
  { title: "Final exam", importanceScore: 95, hour: 9 },
  { title: "Job interview", importanceScore: 90, hour: 10 },
  { title: "Flight departure", importanceScore: 88, hour: 7 },
  { title: "Team standup", importanceScore: 55, hour: 9 },
  { title: "Doctor appointment", importanceScore: 70, hour: 11 },
  { title: "Gym session", importanceScore: 30, hour: 6 },
  { title: "Project deadline", importanceScore: 85, hour: 17 },
  { title: "Coffee with a friend", importanceScore: 20, hour: 15 },
];

export function simulateCalendar(from: Date = new Date()): CalendarEvent[] {
  const picks = [...SAMPLE_EVENTS]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3 + Math.floor(Math.random() * 2));
  return picks
    .map((e, i) => {
      const start = new Date(from);
      start.setDate(start.getDate() + i + 1);
      start.setHours(e.hour, 0, 0, 0);
      return {
        title: e.title,
        start: start.toISOString(),
        importanceScore: e.importanceScore,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Real context with every group that isn't live filled with made-up values,
 * each labelled "simulated". Live weather stays live.
 */
export function withSimulated(real: ContextData): ContextData {
  const data: ContextData = { ...real, sources: { ...real.sources } };
  if (data.sources.weather !== "live") {
    data.weather = simulateWeather();
    data.sources.weather = "simulated";
  }
  data.calendar = simulateCalendar();
  data.sources.calendar = "simulated";
  data.wearable = simulateWearable();
  data.sources.wearable = "simulated";
  return data;
}
