import { describe, it, expect } from "vitest";
import {
  computeWakeConfidence,
  accumulateWakeEvidence,
  meetsThreshold,
  UNSOLVED_CEILING,
  type ChallengeOutcome,
} from "./wakeConfidence";

/**
 * The confidence thresholds `lib/scheduler.ts` can assign to an alarm
 * (`wakeProfileFor`). The gate in wakeConfidence.ts is only meaningful in
 * relation to these numbers, so they are restated here: if the scheduler ever
 * assigns a tier below UNSOLVED_CEILING, an unsolved challenge could satisfy a
 * real alarm and these tests must fail.
 */
const SCHEDULER_THRESHOLDS = [60, 70, 78, 85] as const;
const LOWEST_THRESHOLD = Math.min(...SCHEDULER_THRESHOLDS);

const solve = (over: Partial<ChallengeOutcome> = {}): ChallengeOutcome => ({
  solved: true,
  responseMs: 4000,
  attempts: 1,
  motion: 0.6,
  interactions: 3,
  ...over,
});

describe("the unsolved-challenge gate", () => {
  it("keeps the ceiling below every threshold the scheduler can assign", () => {
    // The load-bearing invariant. Raising UNSOLVED_CEILING to or above 60 means
    // a failed challenge could satisfy the easiest alarm the scheduler creates.
    expect(UNSOLVED_CEILING).toBeLessThan(LOWEST_THRESHOLD);
  });

  it("caps the best possible unsolved attempt at the ceiling", () => {
    // Every ancillary signal maxed out: instant, first try, lots of movement
    // and screen interaction - the exact signature of a phone jostled in bed.
    const result = computeWakeConfidence({
      correctness: 0,
      responseMs: 0,
      attempts: 1,
      motion: 1,
      interactions: 100,
    });

    expect(result.score).toBeLessThanOrEqual(UNSOLVED_CEILING);
    for (const threshold of SCHEDULER_THRESHOLDS) {
      expect(meetsThreshold(result.score, threshold)).toBe(false);
    }
  });

  it("cannot reach any alarm threshold across the whole unsolved signal space", () => {
    // Deterministic sweep rather than random sampling, so a failure is always
    // reproducible.
    let worstCase = 0;
    for (const responseMs of [0, 1000, 6000, 20000, 45000, 90000]) {
      for (const attempts of [0, 1, 2, 5, 20]) {
        for (const motion of [undefined, 0, 0.5, 1, 5]) {
          for (const interactions of [0, 1, 6, 50]) {
            const { score } = computeWakeConfidence({
              correctness: 0,
              responseMs,
              attempts,
              motion,
              interactions,
            });
            worstCase = Math.max(worstCase, score);
            expect(score).toBeLessThanOrEqual(UNSOLVED_CEILING);
            expect(meetsThreshold(score, LOWEST_THRESHOLD)).toBe(false);
          }
        }
      }
    }
    // Documents the actual headroom: the raw model tops out far below the
    // ceiling, so the cap is defence in depth for the full-miss case.
    expect(worstCase).toBeLessThan(UNSOLVED_CEILING);
  });

  it("gates a partially-correct sequence that would otherwise pass", () => {
    // Three of four solved. This is where the ceiling genuinely bites: the raw
    // log-odds land well above the lowest alarm threshold, and only the cap
    // stops a mostly-asleep user dismissing a critical alarm.
    const outcomes = [solve(), solve(), solve(), solve({ solved: false })];
    const result = accumulateWakeEvidence(outcomes);

    expect(result.gated).toBe(true);
    expect(result.score).toBeLessThanOrEqual(UNSOLVED_CEILING);
    expect(meetsThreshold(result.score, LOWEST_THRESHOLD)).toBe(false);
  });

  it("flags gated only when the cap actually changed the outcome", () => {
    // A hopeless attempt scores below the ceiling on its own merits, so no
    // capping occurred and `gated` stays false.
    const hopeless = computeWakeConfidence({
      correctness: 0,
      responseMs: 45000,
      attempts: 8,
      motion: 0,
      interactions: 0,
    });
    expect(hopeless.gated).toBe(false);
    expect(hopeless.score).toBeLessThan(UNSOLVED_CEILING);
  });

  it("treats an explicit solved:false as authoritative over correctness", () => {
    // The API boundary re-scores from raw signals; a client claiming full
    // correctness while reporting an unsolved challenge must not be believed.
    const result = computeWakeConfidence({
      correctness: 1,
      solved: false,
      responseMs: 2000,
      attempts: 1,
      motion: 1,
      interactions: 10,
    });
    expect(result.score).toBeLessThanOrEqual(UNSOLVED_CEILING);
  });
});

describe("discrimination among correct answers", () => {
  it("scores a crisp solve near the top of the range", () => {
    const result = computeWakeConfidence({
      correctness: 1,
      responseMs: 3000,
      attempts: 1,
      motion: 0.8,
      interactions: 5,
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.gated).toBe(false);
  });

  it("scores a fumbled solve far lower", () => {
    const result = computeWakeConfidence({
      correctness: 1,
      responseMs: 40000,
      attempts: 4,
      motion: 0.1,
      interactions: 1,
    });
    expect(result.score).toBeLessThan(60);
    expect(result.score).toBeGreaterThan(UNSOLVED_CEILING);
  });

  it("keeps every scheduler tier both reachable and failable", () => {
    // The regression this guards against: an earlier additive version floored
    // all correct answers at 82, which made 60/70/78 unreachable as failures
    // and turned latency, motion and attempts into decoration.
    const best = computeWakeConfidence({
      correctness: 1,
      responseMs: 0,
      attempts: 1,
      motion: 1,
      interactions: 6,
    }).score;
    const worst = computeWakeConfidence({
      correctness: 1,
      responseMs: 45000,
      attempts: 6,
      motion: 0,
      interactions: 0,
    }).score;

    for (const threshold of SCHEDULER_THRESHOLDS) {
      expect(best).toBeGreaterThanOrEqual(threshold);
      expect(worst).toBeLessThan(threshold);
    }
  });

  it("rewards speed, penalises repeated attempts, and reads stillness as sleepiness", () => {
    const base = { correctness: 1, responseMs: 8000, attempts: 1, motion: 0.5, interactions: 3 };

    expect(computeWakeConfidence({ ...base, responseMs: 2000 }).score).toBeGreaterThan(
      computeWakeConfidence({ ...base, responseMs: 30000 }).score,
    );
    expect(computeWakeConfidence({ ...base, attempts: 1 }).score).toBeGreaterThan(
      computeWakeConfidence({ ...base, attempts: 5 }).score,
    );
    expect(computeWakeConfidence({ ...base, motion: 0.9 }).score).toBeGreaterThan(
      computeWakeConfidence({ ...base, motion: 0.05 }).score,
    );
  });

  it("treats unknown motion as uninformative rather than as credit", () => {
    const result = computeWakeConfidence({
      correctness: 1,
      responseMs: 5000,
      attempts: 1,
      interactions: 2,
    });
    expect(result.evidence.motion).toBe(0);
    expect(result.breakdown.motion).toBe(50);
  });

  it("does not penalise the first attempt", () => {
    const one = computeWakeConfidence({ correctness: 1, responseMs: 5000, attempts: 1 });
    const zero = computeWakeConfidence({ correctness: 1, responseMs: 5000, attempts: 0 });
    // toBeCloseTo rather than toBe: the rounding produces -0, which is
    // arithmetically zero but fails Object.is against +0.
    expect(one.evidence.attempts).toBeCloseTo(0);
    expect(one.score).toBe(zero.score);
  });
});

describe("multi-challenge evidence accumulation", () => {
  it("requires every challenge in the sequence to land", () => {
    const oneMissed = accumulateWakeEvidence([solve(), solve({ solved: false })]);
    expect(oneMissed.gated).toBe(true);
    expect(oneMissed.score).toBeLessThanOrEqual(UNSOLVED_CEILING);
  });

  it("passes a fully-solved sequence well clear of the thresholds", () => {
    const result = accumulateWakeEvidence([solve(), solve()]);
    expect(result.gated).toBe(false);
    expect(meetsThreshold(result.score, LOWEST_THRESHOLD)).toBe(true);
  });

  it("sums time on task so a long fumble stays visible", () => {
    const quick = accumulateWakeEvidence([solve({ responseMs: 3000 }), solve({ responseMs: 3000 })]);
    const slow = accumulateWakeEvidence([solve({ responseMs: 20000 }), solve({ responseMs: 20000 })]);
    expect(slow.score).toBeLessThan(quick.score);
  });

  it("sums attempts across the sequence", () => {
    const clean = accumulateWakeEvidence([solve({ attempts: 1 }), solve({ attempts: 1 })]);
    const messy = accumulateWakeEvidence([solve({ attempts: 3 }), solve({ attempts: 3 })]);
    expect(messy.score).toBeLessThan(clean.score);
  });

  it("scores an empty sequence as an unsolved challenge", () => {
    const result = accumulateWakeEvidence([]);
    expect(result.score).toBeLessThanOrEqual(UNSOLVED_CEILING);
    expect(meetsThreshold(result.score, LOWEST_THRESHOLD)).toBe(false);
  });

  it("averages motion across challenges that reported it, ignoring those that did not", () => {
    const withMotion = accumulateWakeEvidence([
      solve({ motion: 0.9 }),
      solve({ motion: undefined }),
    ]);
    // The single reported reading stands rather than being diluted by a
    // default, so the average is 0.9 rather than 0.45.
    expect(withMotion.breakdown.motion).toBe(90);
  });

  /**
   * Documents current behaviour, which contradicts the "two confirmations are
   * stronger than one" claim in INVENTION_DISCLOSURE.md section 2.
   *
   * `accumulateWakeEvidence` passes correctness as a *ratio*
   * (solvedCount / length), so two perfect solves and one perfect solve both
   * yield correctness = 1 and the same 2.4 log-odds. Meanwhile responseMs and
   * attempts are *summed*, so the longer sequence carries strictly more penalty.
   * Net effect: solving more challenges perfectly scores slightly lower.
   *
   * Pinned here deliberately. If the intended semantics are adopted instead,
   * this test should be inverted rather than deleted.
   */
  it("currently scores a longer perfect sequence no higher than a short one", () => {
    const single = accumulateWakeEvidence([solve()]);
    const double = accumulateWakeEvidence([solve(), solve()]);
    expect(double.score).toBeLessThanOrEqual(single.score);
  });
});
