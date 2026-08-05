import type { ComponentType } from "react";
import type { ChallengeProps, ChallengeType } from "./types";
import MathChallenge from "./MathChallenge";
import TypingChallenge from "./TypingChallenge";
import ShakeChallenge from "./ShakeChallenge";
import QRChallenge from "./QRChallenge";

export const CHALLENGE_COMPONENTS: Record<ChallengeType, ComponentType<ChallengeProps>> = {
  math: MathChallenge,
  typing: TypingChallenge,
  shake: ShakeChallenge,
  qr: QRChallenge,
};

export type { ChallengeProps, ChallengeResult, ChallengeType } from "./types";
export { CHALLENGE_LABELS } from "./types";