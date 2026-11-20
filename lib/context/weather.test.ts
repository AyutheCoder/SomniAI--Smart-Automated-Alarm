import { afterEach, describe, expect, it, vi } from "vitest";
import { coarse, fetchWeather } from "./weather";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the location sent for the weather", () => {
  it("is rounded to about 11 km, so the weather service never learns more", async () => {
    expect(coarse(51.50735)).toBe(51.5);
    expect(coarse(-0.12776)).toBe(-0.1);
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return { ok: true, json: async () => ({ current: { temperature_2m: 7, weather_code: 3 } }) };
    }));
    expect(await fetchWeather(51.50735, -0.12776)).toMatchObject({ tempC: 7 });
    expect(asked).toEqual(["https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&current=temperature_2m,weather_code"]);
  });
});
