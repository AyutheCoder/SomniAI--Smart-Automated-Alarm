export type ChallengeType = "math" | "typing" | "shake" | "qr";

export interface ChallengeResult {
  type: ChallengeType;
  passed: boolean;
  attempts: number;
  responseMs: number;
  motion?: number;
  interactions?: number;
  /** How many answers `responseMs` covers (sums in a maths challenge). Default 1. */
  steps?: number;
}

export interface ChallengeProps {
  onComplete: (result: ChallengeResult) => void;
}

export const CHALLENGE_LABELS: Record<ChallengeType, string> = {
  math: "Math puzzle",
  typing: "Type the phrase",
  shake: "Shake / move",
  qr: "Scan a code",
};