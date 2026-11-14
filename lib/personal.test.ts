import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CARD } from "./modelCard";
import { alarmHabits, betaCdf, betaQuantile, medianInterval, MIN_WAKES, personalRegularity, personalSleep, sleepSd } from "./personal";
import { circularDeviation, regularityLabels, type WakeNight } from "./wakeProxy";

const priors = MODEL_CARD.personalisation;
/** A person who always sleeps `offset` h more than the population model predicts. */
const nights = (n: number, offset: number, predicted = 7) =>
  Array.from({ length: n }, (_, i) => ({ predicted, observed: predicted + offset + (i % 2 ? 0.3 : -0.3) }));
const width = (e: { low: number; high: number }) => e.high - e.low;

describe("the wake-time label is the paper's", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "../tests/fixtures/wake-proxy/nights.json"), "utf8")) as
    { nights: WakeNight[]; labels: (boolean | null)[] };

  it("labels every night exactly as ai-brain/datasets/wake_proxy.py does", () => {
    expect(regularityLabels(fixture.nights)).toEqual(fixture.labels);
    expect(fixture.labels.filter((x) => x === null).length).toBe(15);
  });

  it("whatever order the nights come in", () => {
    const shuffled = [...fixture.nights].reverse();
    expect(regularityLabels(shuffled)).toEqual([...fixture.labels].reverse());
  });

  it("measures around the clock, and only lateness counts", () => {
    expect(circularDeviation(0.2, 23.9)).toBeCloseTo(0.3);
    expect(circularDeviation(23.9, 0.2)).toBeCloseTo(-0.3);
    const early = [7, 7, 7, 5].map((h, i) => ({ date: `2026-08-0${3 + i}`, wakeHour: h })); // Mon-Thu
    expect(regularityLabels(early)).toEqual([null, null, null, true]);
    const late = [7, 7, 7, 7.6].map((h, i) => ({ date: `2026-08-0${3 + i}`, wakeHour: h }));
    expect(regularityLabels(late)).toEqual([null, null, null, false]);
  });
});

describe("personal sleep (normal-normal shrinkage)", () => {
  it("before the threshold: the population model's prediction, with the spread of people, said so", () => {
    const e = personalSleep(7.0, nights(priors.minimumNights - 1, 1.0));
    expect(e.basis).toBe("population");
    expect(e.estimate).toBe(7.0);
    expect(e.nightsToGo).toBe(1);
    expect(width(e)).toBeCloseTo(2 * 1.2816 * Math.sqrt(priors.sleep_duration.withinSd ** 2 + priors.sleep_duration.betweenSd ** 2), 1);
  });

  it("the threshold: the minimum nights, and the person's own nights weighing at least as much as the population", () => {
    expect(priors.minimumNights).toBe(7);
    // The card's half-weight point is about 1.2 nights, so the minimum decides.
    expect(priors.sleep_duration.nightsForHalfWeight).toBeLessThan(priors.minimumNights);
    const at = personalSleep(7.0, nights(7, 1.0));
    expect(at).toMatchObject({ basis: "personal", nights: 7, nightsToGo: 0 });
    expect(at.ownWeight).toBeGreaterThanOrEqual(0.5);
    // With priors where people differ little, more nights are needed: the weight decides.
    const close = { ...priors, sleep_duration: { withinSd: 1.2, betweenSd: 0.3, nightsForHalfWeight: 16 } };
    expect(personalSleep(7.0, nights(10, 1.0), close)).toMatchObject({ basis: "population", nightsToGo: 6 });
    expect(personalSleep(7.0, nights(16, 1.0), close).basis).toBe("personal");
  });

  it("moves toward the person, but not all the way on few nights", () => {
    const seven = personalSleep(7.0, nights(7, 1.0)).estimate;
    const ninety = personalSleep(7.0, nights(90, 1.0)).estimate;
    expect(seven).toBeGreaterThan(7.5);
    expect(seven).toBeLessThan(8.0);
    expect(ninety).toBeGreaterThan(seven);
    expect(ninety).toBeCloseTo(8.0, 1);
  });

  it("uncertainty shrinks as nights grow, toward night-to-night scatter and never below it", () => {
    const widths = [7, 14, 30, 90, 365].map((n) => width(personalSleep(7.0, nights(n, 0))));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
    const floor = 2 * 1.2816 * priors.sleep_duration.withinSd;
    expect(widths[widths.length - 1]).toBeGreaterThan(floor - 0.02);
    expect(sleepSd(0)).toBeGreaterThan(sleepSd(7));
    expect(sleepSd(7)).toBeGreaterThan(sleepSd(100));
  });

  it("a person who sleeps as predicted stays where the model is", () => {
    expect(personalSleep(7.0, nights(30, 0)).estimate).toBeCloseTo(7.0, 1);
  });
});

describe("personal wake-time regularity (beta-binomial)", () => {
  const labelled = (n: number, regularShare: number, predicted = 0.75) =>
    Array.from({ length: n }, (_, i) => ({ regular: i < Math.round(n * regularShare), predicted }));

  it("needs as many labelled nights as the population is worth, and at least the minimum", () => {
    const m = priors.wake_regularity.priorStrength;
    const needed = Math.ceil(Math.max(priors.minimumNights, m));
    expect(personalRegularity(0.75, labelled(needed - 1, 0.4))).toMatchObject({ basis: "population", estimate: 0.75, nightsToGo: 1 });
    expect(personalRegularity(0.75, labelled(needed, 0.4))).toMatchObject({ basis: "personal", nightsToGo: 0 });
  });

  it("before: the population's chance, with the spread of people around it", () => {
    const e = personalRegularity(0.75, []);
    const m = priors.wake_regularity.priorStrength;
    expect(e.low).toBeCloseTo(betaQuantile(0.1, m * 0.75, m * 0.25), 3);
    expect(e.high).toBeCloseTo(betaQuantile(0.9, m * 0.75, m * 0.25), 3);
  });

  it("a person regular on far fewer nights than predicted moves down, more so with more nights", () => {
    const ten = personalRegularity(0.75, labelled(10, 0.3)).estimate;
    const sixty = personalRegularity(0.75, labelled(60, 0.3)).estimate;
    expect(ten).toBeLessThan(0.6);
    expect(sixty).toBeLessThan(ten);
    expect(sixty).toBeGreaterThan(0.3);
  });

  it("uncertainty shrinks as labelled nights grow", () => {
    const widths = [8, 20, 50, 150].map((n) => width(personalRegularity(0.75, labelled(n, 0.75))));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
    expect(width(personalRegularity(0.75, []))).toBeGreaterThan(widths[0]);
  });
});

describe("alarm habits from telemetry (no population exists)", () => {
  const wakes = (n: number, snoozeEvery: number) =>
    Array.from({ length: n }, (_, i) => ({ snoozes: i % snoozeEvery === 0 ? 1 : 0, firstInteractionMs: 5_000 + i * 1_000 }));

  it("nothing before enough of the person's own wakes, and says how many more", () => {
    expect(alarmHabits(wakes(MIN_WAKES - 1, 2))).toEqual({ basis: "none", wakes: 4, wakesToGo: 1, snoozeChance: null, firstTouchMs: null });
  });

  it("from enough wakes: a snooze chance and a typical first touch, each with an interval", () => {
    const h = alarmHabits(wakes(10, 2));
    expect(h.basis).toBe("personal");
    expect(h.snoozeChance!.estimate).toBeCloseTo(6 / 12, 3);
    expect(h.snoozeChance!.low).toBeLessThan(h.snoozeChance!.estimate);
    expect(h.firstTouchMs).toEqual({ estimate: 9_500, low: 7_000, high: 12_000 });
  });

  it("the snooze chance's interval shrinks with more wakes", () => {
    const widths = [5, 20, 80].map((n) => width(alarmHabits(wakes(n, 2)).snoozeChance!));
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(widths[2]).toBeLessThan(widths[1]);
  });
});

describe("the statistics underneath", () => {
  it("beta quantiles and CDF agree with SciPy", () => {
    expect(betaQuantile(0.1, 2, 5)).toBeCloseTo(0.092595, 5);
    expect(betaQuantile(0.9, 2, 5)).toBeCloseTo(0.510316, 5);
    expect(betaQuantile(0.1, 7.36 * 0.75, 7.36 * 0.25)).toBeCloseTo(0.538789, 5);
    expect(betaQuantile(0.25, 0.5, 0.5)).toBeCloseTo(0.146447, 5);
    expect(betaQuantile(0.9, 30, 10)).toBeCloseTo(0.834172, 5);
    expect(betaCdf(0.3, 2, 5)).toBeCloseTo(0.579825, 5);
    expect(betaQuantile(0.37, 1, 1)).toBeCloseTo(0.37, 6);
  });

  it("the median's interval covers at least 80% and widens to the extremes for few values", () => {
    expect(medianInterval([1, 2, 3, 4, 5])).toEqual({ estimate: 3, low: 1, high: 5 });
    // n = 10: P(Bin(10, 1/2) <= 1) = 0.0107, <= 2 = 0.0547, <= 3 = 0.1719 -> j = 3.
    expect(medianInterval([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ estimate: 5.5, low: 3, high: 8 });
  });
});
