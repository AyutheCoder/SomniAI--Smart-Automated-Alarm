// How predictions are described to the user, in one place.
//
// The model once called "wake success" predicts whether someone wakes close
// to their usual time, and nothing more: the paper found the label had no
// association with how anyone felt, and that waking later than habit is
// usually a lie-in rather than a failure. So it is "wake-time regularity",
// its complement is "off your usual time" (not "oversleep"), and no wording
// may suggest the app knows whether a morning went well.
//
// Every prediction shown also says where it came from and how much to trust
// it, in words. The fallback rules' fixed confidence means nothing, so they
// get no number; the AI Brain's is the model's own probability for its answer,
// and the models are weak (AUC 0.66), so even its best is hedged.

export type PredictionOrigin = "ai" | "fallback";

export const ORIGIN_LABEL: Record<PredictionOrigin, string> = {
  ai: "AI Brain",
  fallback: "Fallback rules",
};

export const REGULARITY_LABEL = "Wake-time regularity";
export const REGULARITY_HINT = "Chance you wake close to your usual time. It says nothing about how the morning went.";
export const OFF_SCHEDULE_LABEL = "Off-schedule wake chance";

export interface ConfidenceText {
  /** A few words, shown next to the prediction. */
  label: string;
  /** One sentence saying what that means. */
  detail: string;
}

export const MODEL_CAVEAT = "Its predictions are only modestly better than chance overall.";

export function describeConfidence(origin: PredictionOrigin, confidence?: number): ConfidenceText {
  if (origin === "fallback") {
    return {
      label: "rough estimate",
      detail: "Worked out from simple rules, not a trained model. Treat it as a ballpark.",
    };
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { label: "confidence unknown", detail: `The AI Brain gave no confidence for this. ${MODEL_CAVEAT}` };
  }
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const label = pct >= 80 ? "higher confidence" : pct >= 60 ? "moderate confidence" : "low confidence";
  return {
    label,
    detail: `The model puts ${pct}% on this answer. ${MODEL_CAVEAT}`,
  };
}

/** Wording a user must never see: the old label, and claims the app can't back. */
export const FORBIDDEN_WORDING: readonly RegExp[] = [
  /wake[\s-]*success/i,
  /oversleep/i,
  /clinical/i,
  /medical/i,
  /diagnos/i,
  /\baccura(te|cy)\b/i,
  /\bhealthy\b/i,
  /went well/i,
  /\bon track\b/i,
  /looks great/i,
  /\bdetected\b/i,
  /guarantee/i,
];

export function forbiddenWordingIn(text: string): string[] {
  return FORBIDDEN_WORDING.filter((re) => re.test(text)).map((re) => re.source);
}
