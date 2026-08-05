import type { WeatherInfo } from "./types";

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Severe thunderstorm",
};

function conditionFor(code: number): string {
  return WMO[code] ?? "Unknown";
}

const SIM_CONDITIONS = [
  "Clear",
  "Partly cloudy",
  "Overcast",
  "Light rain",
  "Fog",
];

export function simulateWeather(): WeatherInfo {
  return {
    tempC: Math.round((10 + Math.random() * 20) * 10) / 10,
    condition: SIM_CONDITIONS[Math.floor(Math.random() * SIM_CONDITIONS.length)],
  };
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherInfo> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
      `&longitude=${lon}&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      throw new Error(`Weather HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
      };
    };
    const tempC = json.current?.temperature_2m;
    const code = json.current?.weather_code;
    if (typeof tempC !== "number" || typeof code !== "number") {
      throw new Error("Malformed weather payload");
    }
    return { tempC, condition: conditionFor(code) };
  } catch {
    return simulateWeather();
  }
}