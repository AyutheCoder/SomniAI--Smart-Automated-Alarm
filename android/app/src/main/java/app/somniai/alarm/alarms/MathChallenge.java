package app.somniai.alarm.alarms;

import java.util.Random;

/**
 * One sum, as the web makes them (lib/mathChallenge.ts): a × b + c × d, with
 * a and c from 2 to 9 and b and d from 3 to 12. A maths challenge is
 * {@link #SUMS} of these in a row. Pure; tested in WakeCheckTest.
 */
final class MathChallenge {

    /** Sums in a row to pass one maths challenge, as SUMS in lib/mathChallenge.ts. */
    static final int SUMS = 3;

    final int a;
    final int b;
    final int c;
    final int d;

    MathChallenge(Random random) {
        this(2 + random.nextInt(8), 3 + random.nextInt(10), 2 + random.nextInt(8), 3 + random.nextInt(10));
    }

    MathChallenge(int a, int b, int c, int d) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
    }

    int answer() {
        return a * b + c * d;
    }

    String question() {
        return a + " × " + b + " + " + c + " × " + d;
    }

    /** Whether this is the answer. Anything that isn't a whole number is wrong. */
    boolean check(String answer) {
        if (answer == null) {
            return false;
        }
        try {
            return Integer.parseInt(answer.trim()) == answer();
        }
        catch (NumberFormatException e) {
            return false;
        }
    }
}
