// Personal predictions (prompt 5.3): the population model, adjusted to one
// person by their own nights, with uncertainty that says how little one
// person's data is. Pure; lib/personalServer.ts gathers the data.
//
// How far people sit from the population model was measured on held-out
// LifeSnaps participants (model card "personalisation", written by
// ai-brain/training/train_shipped.py):
//
// * Sleep duration: a person's offset from the model is normal with sd
//   betweenSd; their nights scatter around it with sd withinSd. Their own
//   nights shrink the offset's uncertainty as 1/(1/between² + n/within²), so
//   the interval narrows from the population's toward night-to-night scatter.
// * Wake-time regularity: a person's rate of regular nights is beta around
//   the population model's own predictions for their nights, worth
//   priorStrength nights; each labelled night adds one.
//
// A prediction is personal only from minimumNights of a person's own nights,
// and only once they weigh at least as much as the population. Before that it
// is the population model's, and says so.
//
// Alarm habits (snoozes, time to first touch) come from telemetry, which no
// public dataset has: there is no population model for them, so nothing is
// shown until a person has enough recorded wakes of their own.

import { MODEL_CARD } from "./modelCard";

/** The interval shown: 80%, so it says "likely", not "certainly". */
export const INTERVAL = 0.8;
const Z80 = 1.2815515655446004;
/** Recorded wakes before alarm habits are shown at all. */
export const MIN_WAKES = 5;

export type Priors = typeof MODEL_CARD.personalisation;

export interface Estimate {
  /** "personal" once the person's own data counts; "population" before. */
  basis: "personal" | "population";
  estimate: number;
  low: number;
  high: number;
  /** The person's own data used: nights (or labelled nights). */
  nights: number;
  /** How much the person's own nights weigh against the population, 0 to 1. */
  ownWeight: number;
  /** More nights until it becomes personal; 0 once it is. */
  nightsToGo: number;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function nightsNeeded(n: number, halfWeightAt: number, minimum: number): number {
  return Math.max(0, Math.ceil(Math.max(minimum, halfWeightAt)) - n);
}

/**
 * Tonight's sleep, from the population model's prediction and the person's
 * own nights: each with what they slept and what the population model had
 * predicted for that night.
 */
export function personalSleep(populationTonight: number, history: { observed: number; predicted: number }[],
  priors: Priors = MODEL_CARD.personalisation): Estimate {
  const { withinSd, betweenSd } = priors.sleep_duration;
  const within2 = withinSd ** 2;
  const between2 = betweenSd ** 2;
  const n = history.length;
  const offsetVar = 1 / (1 / between2 + n / within2);
  const offset = offsetVar * history.reduce((s, h) => s + (h.observed - h.predicted), 0) / within2;
  const ownWeight = n / (n + within2 / between2);
  const toGo = nightsNeeded(n, within2 / between2, priors.minimumNights);
  const personal = toGo === 0;
  // Before the threshold: the population's prediction, with the population's spread of people.
  const estimate = personal ? populationTonight + offset : populationTonight;
  const sd = Math.sqrt(within2 + (personal ? offsetVar : between2));
  return {
    basis: personal ? "personal" : "population",
    estimate: round(clamp(estimate, 0, 16), 2),
    low: round(clamp(estimate - Z80 * sd, 0, 16), 2),
    high: round(clamp(estimate + Z80 * sd, 0, 16), 2),
    nights: n,
    ownWeight: round(ownWeight, 3),
    nightsToGo: toGo,
  };
}

/**
 * Tonight's chance of waking close to the usual time, from the population
 * model's and the person's own labelled nights (regular or not, with the
 * population model's prediction for each).
 */
export function personalRegularity(populationTonight: number, history: { regular: boolean; predicted: number }[],
  priors: Priors = MODEL_CARD.personalisation): Estimate {
  const m = priors.wake_regularity.priorStrength;
  const n = history.length;
  const toGo = nightsNeeded(n, m, priors.minimumNights);
  const personal = toGo === 0;
  let mean = clamp(populationTonight, 0.01, 0.99);
  let strength = m;
  if (personal) {
    // The person's rate against what the population model expected for their nights.
    const expected = history.reduce((s, h) => s + h.predicted, 0) / n;
    const regular = history.filter((h) => h.regular).length;
    const rate = (m * expected + regular) / (m + n);
    mean = clamp(populationTonight + (rate - expected), 0.01, 0.99);
    strength = m + n;
  }
  const a = strength * mean;
  const b = strength * (1 - mean);
  return {
    basis: personal ? "personal" : "population",
    estimate: round(mean, 3),
    low: round(betaQuantile((1 - INTERVAL) / 2, a, b), 3),
    high: round(betaQuantile(1 - (1 - INTERVAL) / 2, a, b), 3),
    nights: n,
    ownWeight: round(n / (n + m), 3),
    nightsToGo: toGo,
  };
}

export interface AlarmHabits {
  basis: "personal" | "none";
  wakes: number;
  wakesToGo: number;
  /** Chance a wake has at least one snooze. */
  snoozeChance: { estimate: number; low: number; high: number } | null;
  /** Typical time from the first ring to the first touch, ms (median, with an interval for the median). */
  firstTouchMs: { estimate: number; low: number; high: number } | null;
}

/**
 * From the person's recorded wakes (telemetry). No population exists for
 * these, so the prior is flat and nothing is shown before MIN_WAKES.
 */
export function alarmHabits(wakes: { snoozes: number; firstInteractionMs: number | null }[]): AlarmHabits {
  const n = wakes.length;
  if (n < MIN_WAKES) {
    return { basis: "none", wakes: n, wakesToGo: MIN_WAKES - n, snoozeChance: null, firstTouchMs: null };
  }
  const snoozed = wakes.filter((w) => w.snoozes > 0).length;
  const a = 1 + snoozed;
  const b = 1 + n - snoozed;
  const touches = wakes.map((w) => w.firstInteractionMs).filter((x): x is number => typeof x === "number").sort((x, y) => x - y);
  return {
    basis: "personal",
    wakes: n,
    wakesToGo: 0,
    snoozeChance: {
      estimate: round(a / (a + b), 3),
      low: round(betaQuantile((1 - INTERVAL) / 2, a, b), 3),
      high: round(betaQuantile(1 - (1 - INTERVAL) / 2, a, b), 3),
    },
    firstTouchMs: touches.length >= MIN_WAKES ? medianInterval(touches) : null,
  };
}

/** The median, and a distribution-free interval for it from order statistics (at least INTERVAL coverage). */
export function medianInterval(sorted: number[]): { estimate: number; low: number; high: number } {
  const n = sorted.length;
  const mid = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // [x(j), x(n+1-j)] covers the median with probability 1 - 2 P(Binomial(n, 1/2) <= j-1):
  // the largest j that keeps that at least INTERVAL (j = 1, min to max, when n is small).
  const tail = (1 - INTERVAL) / 2;
  let j = 1;
  let below = 0; // P(X <= k)
  for (let k = 0; k < Math.floor(n / 2); k++) {
    below += binomialHalf(n, k);
    if (below > tail) {
      break;
    }
    j = k + 1;
  }
  j = Math.min(j, Math.ceil(n / 2));
  return { estimate: mid, low: sorted[j - 1], high: sorted[n - j] };
}

function binomialHalf(n: number, k: number): number {
  return Math.exp(logChoose(n, k) - n * Math.LN2);
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

// --- the beta distribution's quantiles, for the intervals ---------------------

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9), accurate to ~1e-15 for x > 0.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-14) {
      break;
    }
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b): the beta distribution's CDF. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** The q-quantile of Beta(a, b), by bisection on the CDF. */
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < q) {
      lo = mid;
    }
    else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** The predictive sd for sleep before and after n nights: for showing that uncertainty shrinks. */
export function sleepSd(n: number, priors: Priors = MODEL_CARD.personalisation): number {
  const { withinSd, betweenSd } = priors.sleep_duration;
  return Math.sqrt(withinSd ** 2 + 1 / (1 / betweenSd ** 2 + n / withinSd ** 2));
}
