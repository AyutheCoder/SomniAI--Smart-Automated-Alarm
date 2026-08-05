/**
 * Wake confidence: how strongly does the evidence say this person is actually awake?
 *
 * The model is a naive-Bayes log-odds accumulator. Each signal contributes a
 * log-likelihood ratio - evidence for "awake" versus "responding on autopilot"
 * - and the total is squashed back into a 0..100 score.
 *
 * Two properties matter, and the previous additive-logit version had neither:
 *
 *   1. Solving the challenge is *necessary*, not merely heavily weighted. It was
 *      possible to fail the challenge outright and still outscore someone who
 *      solved it, by answering fast while moving (a phone jostled on a mattress
 *      produces exactly that signature). Correctness is now a gate: an unsolved
 *      challenge is capped below every threshold the scheduler can assign.
 *
 *   2. The remaining signals have to *discriminate* among correct answers. With
 *      the old weights any correct answer scored at least 82, which put three of
 *      the four scheduler tiers (60/70/78) permanently out of reach as failures
 *      and made latency, motion and attempts decorative. Correct answers now
 *      span roughly 40..98, so every tier separates a crisp wake from a fumbled
 *      one.
 */

export type ChallengeOutcome = {
  solved: boolean;
  responseMs: number;
  attempts: number;
  motion?: number;
  interactions?: number;
};

export interface WakeSignals {
  /** Fraction of challenges solved, 0..1. */
  correctness: number;
  responseMs: number;
  attempts: number;
  motion?: number;
  interactions?: number;
  /** Explicit gate. Defaults to `correctness >= 1` when omitted. */
  solved?: boolean;
}

export interface WakeConfidence {
  score: number;
  /** Per-signal log-odds contributions, for the "why this score" panel. */
  evidence: {
    correctness: number;
    speed: number;
    attempts: number;
    motion: number;
    interactions: number;
  };
  breakdown: {
    correctness: number;
    speed: number;
    motion: number;
    attemptPenalty: number;
  };
  gated: boolean;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Response times bracketing "instant" and "fell back asleep mid-question". */
const FAST_MS = 6000;
const SLOW_MS = 45000;

const W = {
  /** Alarms fire during sleep inertia, so start slightly sceptical. */
  prior: -0.2,
  solved: 2.4,
  unsolved: -3.4,
  speed: 1.0,
  attempts: -0.9,
  motion: 0.7,
  interactions: 0.3,
};

/**
 * Ceiling applied when the challenge was not solved. Sits below the lowest
 * `minConfidence` the scheduler assigns (60), so failing the challenge can never
 * satisfy any alarm however lively the accelerometer looks.
 */
export const UNSOLVED_CEILING = 35;

export function computeWakeConfidence(signals: WakeSignals): WakeConfidence {
  const correctness = clamp01(signals.correctness);
  const solved = signals.solved ?? correctness >= 1;

  const speedNorm = clamp01((SLOW_MS - signals.responseMs) / (SLOW_MS - FAST_MS));
  // Unknown motion is genuinely uninformative, so it contributes nothing rather
  // than half a point of unearned credit.
  const motionNorm = signals.motion === undefined ? 0.5 : clamp01(signals.motion);
  // The first attempt is free; repeated tries are what signal grogginess.
  const attemptPenalty = clamp01(Math.max(0, signals.attempts - 1) / 3);
  const interactionNorm = clamp01((signals.interactions ?? 0) / 6);

  const evidence = {
    // Partial credit across a multi-challenge sequence scales between the two poles.
    correctness: W.unsolved + (W.solved - W.unsolved) * correctness,
    speed: (2 * speedNorm - 1) * W.speed,
    attempts: attemptPenalty * W.attempts,
    motion: (2 * motionNorm - 1) * W.motion,
    interactions: interactionNorm * W.interactions,
  };

  const logOdds =
    W.prior +
    evidence.correctness +
    evidence.speed +
    evidence.attempts +
    evidence.motion +
    evidence.interactions;

  let score = Math.round(sigmoid(logOdds) * 100);
  const gated = !solved && score > UNSOLVED_CEILING;
  if (!solved) {
    score = Math.min(score, UNSOLVED_CEILING);
  }

  return {
    score,
    evidence: {
      correctness: Math.round(evidence.correctness * 100) / 100,
      speed: Math.round(evidence.speed * 100) / 100,
      attempts: Math.round(evidence.attempts * 100) / 100,
      motion: Math.round(evidence.motion * 100) / 100,
      interactions: Math.round(evidence.interactions * 100) / 100,
    },
    breakdown: {
      correctness: Math.round(correctness * 100),
      speed: Math.round(speedNorm * 100),
      motion: Math.round(motionNorm * 100),
      attemptPenalty: Math.round(attemptPenalty * 100),
    },
    gated,
  };
}

/**
 * Fold a sequence of challenge outcomes into one score.
 *
 * Evidence accumulates across challenges rather than being averaged, so two
 * independent confirmations read as stronger than one, and a single lucky guess
 * after several failures does not erase the failures.
 */
export function accumulateWakeEvidence(outcomes: ChallengeOutcome[]): WakeConfidence {
  if (outcomes.length === 0) {
    return computeWakeConfidence({ correctness: 0, responseMs: SLOW_MS, attempts: 0 });
  }
  const solvedCount = outcomes.filter((o) => o.solved).length;
  const motions = outcomes.map((o) => o.motion).filter((m): m is number => m !== undefined);

  return computeWakeConfidence({
    correctness: solvedCount / outcomes.length,
    // Total time on task, not per-challenge, so a long fumble stays visible.
    responseMs: outcomes.reduce((s, o) => s + o.responseMs, 0),
    attempts: outcomes.reduce((s, o) => s + o.attempts, 0),
    motion: motions.length ? motions.reduce((s, m) => s + m, 0) / motions.length : undefined,
    interactions: outcomes.reduce((s, o) => s + (o.interactions ?? 0), 0),
    // Every challenge in the sequence has to land.
    solved: solvedCount === outcomes.length,
  });
}

export function meetsThreshold(score: number, minConfidence: number): boolean {
  return score >= minConfidence;
}

/** Human-readable reason a score landed where it did, strongest signal first. */
export function explainConfidence(result: WakeConfidence): string[] {
  const labels: Record<keyof WakeConfidence["evidence"], [string, string]> = {
    correctness: ["Solved the challenge", "Did not solve the challenge"],
    speed: ["Answered quickly", "Answered slowly"],
    attempts: ["First-try answer", "Needed several attempts"],
    motion: ["Moving around", "Lying still"],
    interactions: ["Interacting with the screen", "Little screen interaction"],
  };
  return (Object.keys(result.evidence) as (keyof WakeConfidence["evidence"])[])
    .map((k) => ({ k, v: result.evidence[k] }))
    .filter((e) => Math.abs(e.v) >= 0.05)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .map((e) => `${labels[e.k][e.v >= 0 ? 0 : 1]} (${e.v >= 0 ? "+" : ""}${e.v})`);
}
