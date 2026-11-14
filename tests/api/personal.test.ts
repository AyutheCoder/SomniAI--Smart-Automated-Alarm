import { describe, expect, it, vi } from "vitest";
import { GET as recommendations } from "@/app/api/recommendations/route";
import type { ModelFeatures } from "@/lib/aiClient";
import { historyRows, localHour, personalPredictions } from "@/lib/personalServer";
import { personalLines } from "@/lib/personalText";
import { forbiddenWordingIn } from "@/lib/predictionCopy";
import { SleepLog } from "@/models/SleepLog";
import { TelemetryConsent } from "@/models/TelemetryConsent";
import { WakeTelemetry } from "@/models/WakeTelemetry";
import { makeUser, read, request, signInAs } from "./helpers";

const DAY = 86_400_000;

/** n nights from 2026-09-01: asleep 23:00Z, up 07:00Z (+ late on every fifth), `hours` asleep. */
async function nights(userId: string, n: number, hours = 8.0, source = "manual") {
  for (let i = 0; i < n; i++) {
    const wake = new Date(Date.UTC(2026, 8, 1, 7, 0) + i * DAY + (i % 5 === 4 ? 90 * 60_000 : 0));
    await SleepLog.create({
      userId, date: wake.toISOString().slice(0, 10), source,
      sleepTime: new Date(wake.getTime() - 8 * 3_600_000), wakeTime: wake, durationHours: hours, restingHr: 60 + (i % 3),
    });
  }
}

/** The AI Brain's batch, stubbed: the population model says 7.0 h and 0.75 for every night. */
function populationSays(sleep = 7.0, regular = 0.75) {
  const seen: ModelFeatures[][] = [];
  const batch = vi.fn(async (rows: ModelFeatures[]) => {
    seen.push(rows);
    return { sleep: rows.map(() => sleep), regular: rows.map(() => regular) };
  });
  return { batch, seen };
}

const tonight = { features: {}, sleep: 7.0, regular: 0.75, fromModel: true };

describe("personal predictions", () => {
  it("with enough nights: personal, moved toward the person, and said so", async () => {
    const me = await makeUser();
    await nights(me, 30, 8.0);
    const { batch } = populationSays();
    const p = await personalPredictions(me, tonight, "UTC", { batch });
    expect(p.available).toBe(true);
    expect(p.sleep).toMatchObject({ basis: "personal", nights: 30, nightsToGo: 0 });
    // Slept an hour more than the model said, every night: most of the way there.
    expect(p.sleep!.estimate).toBeGreaterThan(7.8);
    expect(p.sleep!.estimate).toBeLessThan(8.0);
    // Late on every fifth night (90 minutes), so less regular than the model's 75%.
    expect(p.regularity!.basis).toBe("personal");
    const lines = personalLines(p);
    expect(lines[0].text).toMatch(/^Personal, from your 30 nights: about 8\.0 h of sleep tonight, likely/);
    expect(forbiddenWordingIn(lines.map((l) => l.text).join(" "))).toEqual([]);
  });

  it("before the threshold: the population model, and how many nights are still needed", async () => {
    const me = await makeUser();
    await nights(me, 5, 8.0);
    const p = await personalPredictions(me, tonight, "UTC", populationSays());
    expect(p.sleep).toMatchObject({ basis: "population", estimate: 7.0, nights: 5, nightsToGo: 2 });
    expect(p.regularity!.basis).toBe("population");
    expect(personalLines(p)[0].text).toMatch(/^The population model's, not yet yours: about 7\.0 h, .* Personal after 2 nights more/);
  });

  it("uncertainty shrinks as the person's nights grow", async () => {
    const widths: number[] = [];
    for (const n of [7, 21, 60]) {
      const me = await makeUser();
      await nights(me, n, 7.5);
      const p = await personalPredictions(me, tonight, "UTC", populationSays());
      widths.push(p.sleep!.high - p.sleep!.low);
    }
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(widths[2]).toBeLessThan(widths[1]);
  });

  it("each past night is described as the model would have seen it the evening before: nothing from that night or after", async () => {
    const logs = [7.0, 9.0, 5.0].map((h, i) => ({
      date: `2026-09-0${i + 1}`, durationHours: h, sleepTime: new Date(Date.UTC(2026, 8, i, 23, 0)), restingHr: 60,
    }));
    const rows = historyRows(logs as never, "owl", 8);
    expect(rows[0]).toEqual({ chronotype_code: 2, bedtime_hour: expect.any(Number), resting_hr: 60 });
    // Night 2 knows night 1 only (7 h against an 8 h goal); night 3 knows nights 1 and 2.
    expect(rows[1].sleep_debt_hours).toBeCloseTo(1.0);
    expect(rows[2].sleep_debt_hours).toBeCloseTo(0.0);
  });

  it("simulated nights are not the person's", async () => {
    const me = await makeUser();
    await nights(me, 5, 8.0);
    await SleepLog.create({ userId: me, date: "2026-10-30", source: "simulated", durationHours: 4, sleepTime: new Date("2026-10-29T23:00:00Z"), wakeTime: new Date("2026-10-30T03:00:00Z") });
    const { batch, seen } = populationSays();
    const p = await personalPredictions(me, tonight, "UTC", { batch });
    expect(p.sleep!.nights).toBe(5);
    expect(seen[0]).toHaveLength(5);
  });

  describe("the fallback", () => {
    it("without the AI Brain's model, nothing is personalised, and it says so", async () => {
      const me = await makeUser();
      await nights(me, 30);
      const { batch } = populationSays();
      const p = await personalPredictions(me, { ...tonight, fromModel: false }, "UTC", { batch });
      expect(p).toMatchObject({ available: false, reason: "Personal predictions build on the AI Brain's model, which isn't reachable; these are the simple rules." });
      expect(p.sleep).toBeUndefined();
      expect(batch).not.toHaveBeenCalled();
    });

    it("if the AI Brain doesn't answer for the past nights, the population model alone, said so", async () => {
      const me = await makeUser();
      await nights(me, 30);
      const p = await personalPredictions(me, tonight, "UTC", { batch: vi.fn(async () => null) });
      expect(p).toMatchObject({ available: false, reason: "The AI Brain didn't answer for your past nights, so these are the population model's alone." });
    });

    it("the route: with no AI Brain here, the predictions are the rules' and the personal part says why", async () => {
      const me = await makeUser();
      signInAs(me);
      await nights(me, 10);
      const res = await read(await recommendations(request("GET", "/api/recommendations?tz=Asia%2FKolkata")));
      expect(res.body.data.predictionSource).toBe("fallback");
      expect(res.body.data.personal).toMatchObject({ available: false, alarm: { basis: "off" } });
    });
  });

  describe("alarm habits, from telemetry, only with consent", () => {
    const wake = (userId: string, i: number, snoozes: number) => ({
      userId, alarmId: "a", scheduledFor: new Date(Date.UTC(2026, 9, 1 + i, 1, 30)), consentVersion: "telemetry-v1",
      firstRingAt: new Date(Date.UTC(2026, 9, 1 + i, 1, 30)), endedAt: new Date(Date.UTC(2026, 9, 1 + i, 1, 35)),
      outcome: "dismissed", snoozes, firstInteractionMs: 8_000 + i * 500, stageReached: { level: 1, stage: "ramp" },
      verification: { required: false, result: "not_required" }, rings: [], receivedAt: new Date(),
    });

    it("off without consent, even with wakes stored from before", async () => {
      const me = await makeUser();
      for (let i = 0; i < 6; i++) {
        await WakeTelemetry.create(wake(me, i, i % 2));
      }
      await TelemetryConsent.create({ userId: me, granted: false, version: null, grantedAt: null, withdrawnAt: new Date(), deletedAt: null, history: [] });
      expect((await personalPredictions(me, tonight, "UTC", populationSays())).alarm).toEqual({ basis: "off" });
    });

    it("with consent: nothing before 5 wakes, then the person's own with intervals", async () => {
      const me = await makeUser();
      await TelemetryConsent.create({ userId: me, granted: true, version: "telemetry-v1", grantedAt: new Date("2026-09-01"), withdrawnAt: null, deletedAt: null, history: [] });
      for (let i = 0; i < 3; i++) {
        await WakeTelemetry.create(wake(me, i, 1));
      }
      expect((await personalPredictions(me, tonight, "UTC", populationSays())).alarm).toMatchObject({ basis: "none", wakes: 3, wakesToGo: 2 });
      for (let i = 3; i < 8; i++) {
        await WakeTelemetry.create(wake(me, i, i % 2));
      }
      const a = (await personalPredictions(me, tonight, "UTC", populationSays())).alarm;
      expect(a).toMatchObject({ basis: "personal", wakes: 8 });
      expect(personalLines({ available: false, alarm: a }).at(-1)!.text).toMatch(/^From your 8 recorded wakes: you snooze on about \d+% of mornings \(likely \d+% to \d+%\) and first touch the phone after about [\d.]+ s/);
    });
  });

  it("the wake time is read in the person's own timezone", () => {
    expect(localHour(new Date("2026-09-01T01:30:00Z"), "Asia/Kolkata")).toBeCloseTo(7.0);
    expect(localHour(new Date("2026-09-01T01:30:00Z"), "Not/AZone")).toBeCloseTo(1.5);
    expect(localHour(new Date("2026-09-01T01:30:00Z"), undefined)).toBeCloseTo(1.5);
  });
});
