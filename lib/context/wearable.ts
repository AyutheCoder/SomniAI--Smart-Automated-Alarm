import type { WearableInfo } from "./types";

export function simulateWearable(): WearableInfo {
  return {
    restingHr: 52 + Math.floor(Math.random() * 20),
    steps: Math.floor(Math.random() * 12000),
    lastSleepHours: Math.round((5 + Math.random() * 4) * 10) / 10,
  };
}