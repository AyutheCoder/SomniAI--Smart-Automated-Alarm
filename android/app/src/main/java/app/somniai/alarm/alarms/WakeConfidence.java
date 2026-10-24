package app.somniai.alarm.alarms;

import java.util.List;

/**
 * Wake confidence, the same model as lib/wakeConfidence.ts, so an alarm can be
 * verified on the phone with no network. Kept line for line with the
 * TypeScript; WakeConfidenceTest restates its tests and checks a shared table
 * of cases that lib/wakeConfidence.parity.test.ts checks against the
 * TypeScript, so the two can't drift apart.
 *
 * The rule that matters: solving the challenge is necessary. An unsolved
 * challenge is capped at {@link #UNSOLVED_CEILING}, below every threshold an
 * alarm can have, so a wrong answer can never dismiss.
 */
final class WakeConfidence {

    /** Below the lowest minConfidence the scheduler assigns (60). */
    static final int UNSOLVED_CEILING = 35;

    private static final double FAST_MS = 6000;
    private static final double SLOW_MS = 45000;
    private static final double W_PRIOR = -0.2;
    private static final double W_SOLVED = 2.4;
    private static final double W_UNSOLVED = -3.4;
    private static final double W_SPEED = 1.0;
    private static final double W_ATTEMPTS = -0.9;
    private static final double W_MOTION = 0.7;
    private static final double W_INTERACTIONS = 0.3;

    private WakeConfidence() {}

    /** As WakeSignals in the TypeScript; null means "not reported". */
    static final class Signals {
        final double correctness;
        final double responseMs;
        final double attempts;
        final Double motion;
        final Double interactions;
        final Boolean solved;

        Signals(double correctness, double responseMs, double attempts, Double motion, Double interactions, Boolean solved) {
            this.correctness = correctness;
            this.responseMs = responseMs;
            this.attempts = attempts;
            this.motion = motion;
            this.interactions = interactions;
            this.solved = solved;
        }
    }

    /** One challenge in a sequence, as ChallengeOutcome in the TypeScript. */
    static final class Outcome {
        final boolean solved;
        final double responseMs;
        final double attempts;
        final Double motion;
        final Double interactions;

        Outcome(boolean solved, double responseMs, double attempts, Double motion, Double interactions) {
            this.solved = solved;
            this.responseMs = responseMs;
            this.attempts = attempts;
            this.motion = motion;
            this.interactions = interactions;
        }
    }

    static final class Result {
        final int score;
        final boolean gated;

        Result(int score, boolean gated) {
            this.score = score;
            this.gated = gated;
        }
    }

    static Result compute(Signals s) {
        double correctness = clamp01(s.correctness);
        boolean solved = s.solved != null ? s.solved : correctness >= 1;

        double speedNorm = clamp01((SLOW_MS - s.responseMs) / (SLOW_MS - FAST_MS));
        double motionNorm = s.motion == null ? 0.5 : clamp01(s.motion);
        double attemptPenalty = clamp01(Math.max(0, s.attempts - 1) / 3);
        double interactionNorm = clamp01((s.interactions == null ? 0 : s.interactions) / 6);

        double logOdds = W_PRIOR
            + (W_UNSOLVED + (W_SOLVED - W_UNSOLVED) * correctness)
            + (2 * speedNorm - 1) * W_SPEED
            + attemptPenalty * W_ATTEMPTS
            + (2 * motionNorm - 1) * W_MOTION
            + interactionNorm * W_INTERACTIONS;

        // JavaScript's Math.round and Java's agree for non-negative values.
        int score = (int) Math.round(sigmoid(logOdds) * 100);
        boolean gated = !solved && score > UNSOLVED_CEILING;
        if (!solved) {
            score = Math.min(score, UNSOLVED_CEILING);
        }
        return new Result(score, gated);
    }

    /** Folds a challenge sequence into one score, as accumulateWakeEvidence. */
    static Result accumulate(List<Outcome> outcomes) {
        if (outcomes.isEmpty()) {
            return compute(new Signals(0, SLOW_MS, 0, null, null, null));
        }
        int solvedCount = 0;
        double responseMs = 0;
        double attempts = 0;
        double interactions = 0;
        double motionSum = 0;
        int motions = 0;
        for (Outcome o : outcomes) {
            if (o.solved) {
                solvedCount++;
            }
            responseMs += o.responseMs;
            attempts += o.attempts;
            interactions += o.interactions == null ? 0 : o.interactions;
            if (o.motion != null) {
                motionSum += o.motion;
                motions++;
            }
        }
        return compute(new Signals(
            (double) solvedCount / outcomes.size(),
            responseMs,
            attempts,
            motions > 0 ? motionSum / motions : null,
            interactions,
            solvedCount == outcomes.size()));
    }

    static boolean meetsThreshold(int score, int minConfidence) {
        return score >= minConfidence;
    }

    private static double sigmoid(double x) {
        return 1 / (1 + Math.exp(-x));
    }

    private static double clamp01(double x) {
        return Math.min(1, Math.max(0, x));
    }
}
