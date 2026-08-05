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

export interface ContextData {
  weather?: WeatherInfo;
  calendar?: CalendarEvent[];
  wearable?: WearableInfo;
}

export type ContextSource = "simulated" | "live";