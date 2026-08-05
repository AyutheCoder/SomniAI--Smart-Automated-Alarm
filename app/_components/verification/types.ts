export type ChallengeType = "math" | "typing" | "shake" | "qr";

export interface ChallengeResult {
  type: ChallengeType;
  passed: boolean;
  attempts: number;
  responseMs: number;
  motion?: number;
  interactions?: number;
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