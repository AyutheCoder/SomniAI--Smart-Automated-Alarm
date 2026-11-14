import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as simulatedContext } from "@/app/api/dev/simulated-context/route.dev";
import { GET as context } from "@/app/api/context/route";
import { buildUserSignals } from "@/lib/aiFeatures";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { makeUser, read, request, signInAs } from "./helpers";

// The developer simulator's API (prompt 4.4): only under `next dev`, which the
// guard test and `npm run verify` check. Here: what it does when it's there.
const post = async (body: unknown) => read(await simulatedContext(request("POST", "/api/dev/simulated-context", body)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/dev/simulated-context", () => {
  it("only for a signed-in user", async () => {
    await makeUser(); // connects the test database, which the refused request never touches
    signInAs(null);
    expect((await post({})).status).toBe(401);
    expect(await ContextSnapshot.countDocuments()).toBe(0);
  });

  it("stores made-up context labelled simulated, which predictions don't use", async () => {
    const me = await makeUser();
    signInAs(me);
    const res = await post({});
    expect(res.status).toBe(201);
    expect(res.body.data.sources).toEqual({ weather: "simulated", calendar: "simulated", wearable: "simulated" });
    expect(res.body.data.wearable.restingHr).toEqual(expect.any(Number));
    const sources = (await read(await context(request("GET", "/api/context")))).body.data.sources;
    expect(sources.wearable).toEqual({ source: "simulated", detail: "Simulated: not used for predictions" });
    expect((await buildUserSignals(me)).features).not.toHaveProperty("resting_hr");
  });

  it("with a location the weather is live, and only the rest is made up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ current: { temperature_2m: 30, weather_code: 63 } }))));
    signInAs(await makeUser());
    const res = await post({ lat: 28.6, lon: 77.2 });
    expect(res.body.data.weather).toEqual({ tempC: 30, condition: "Rain" });
    expect(res.body.data.sources).toEqual({ weather: "live", calendar: "simulated", wearable: "simulated" });
  });

  it("checks the location like /api/context", async () => {
    signInAs(await makeUser());
    expect((await post({ lat: 12 })).body.error).toMatch(/lat and lon must be given together/);
    expect(await ContextSnapshot.countDocuments()).toBe(0);
  });
});
