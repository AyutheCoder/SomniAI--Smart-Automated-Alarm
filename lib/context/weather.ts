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

/**
 * Live weather for a location, or null when it can't be had. It used to fall
 * back to a weather simulator here, so a network failure quietly produced made-up
 * weather that nothing could tell apart from the real thing.
 */
/**
 * A coordinate to one decimal place, about 11 km: enough for the weather, and
 * not where someone lives (7.2). The page rounds before sending, and this
 * rounds again, so neither SomniAI's server nor the weather service gets more.
 * Nothing stores the coordinates; the snapshot keeps the weather only.
 */
export function coarse(degrees: number): number {
  return Math.round(degrees * 10) / 10;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherInfo | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coarse(lat)}` +
      `&longitude=${coarse(lon)}&current=temperature_2m,weather_code`;
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
    return null;
  }
}