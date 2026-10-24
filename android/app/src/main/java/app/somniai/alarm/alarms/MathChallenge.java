package app.somniai.alarm.alarms;

import java.util.Random;

/**
 * One maths problem, as the web's MathChallenge makes them: a × b with a and
 * b from 6 to 13. Pure; tested in WakeCheckTest.
 */
final class MathChallenge {

    final int a;
    final int b;
    private final long startedAt;
    private final int wrongAnswers;

    MathChallenge(Random random, long now) {
        this(6 + random.nextInt(8), 6 + random.nextInt(8), now, 0);
    }

    private MathChallenge(int a, int b, long startedAt, int wrongAnswers) {
        this.a = a;
        this.b = b;
        this.startedAt = startedAt;
        this.wrongAnswers = wrongAnswers;
    }

    String question() {
        return a + " × " + b;
    }

    /** Whether this is the answer. Anything that isn't a whole number is wrong. */
    boolean check(String answer) {
        if (answer == null) {
            return false;
        }
        try {
            return Integer.parseInt(answer.trim()) == a * b;
        }
        catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * After a wrong answer: a new problem, the attempt counted, and the clock
     * still running from the first problem, as on the web.
     */
    MathChallenge next(Random random, long now) {
        return new MathChallenge(6 + random.nextInt(8), 6 + random.nextInt(8), startedAt, wrongAnswers + 1);
    }

    int wrongAnswers() {
        return wrongAnswers;
    }

    /** The outcome once solved: the web reports attempts as wrong answers, interactions as all answers. */
    WakeConfidence.Outcome outcome(long now) {
        return new WakeConfidence.Outcome(true, now - startedAt, wrongAnswers, null, (double) (wrongAnswers + 1));
    }
}
