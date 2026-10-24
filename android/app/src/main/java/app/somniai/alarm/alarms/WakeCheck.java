package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The native wake check: maths problems on the ring screen, scored with
 * {@link WakeConfidence}, gated the way the web's RingingOverlay gates it. The
 * alarm is dismissed only when every challenge in the sequence was solved
 * <em>and</em> the score meets the ring plan's minConfidence. A wrong answer
 * never dismisses: it brings a new problem and counts as an attempt, as on the
 * web. A sequence that is solved but scores too low starts again.
 *
 * Pure; the clock and the random source are passed in. Tested in WakeCheckTest.
 */
final class WakeCheck {

    /** The ring plan's challenge (lib/ringPlan.ts, challenge). */
    static final class Plan {
        final boolean required;
        /** How many challenges in a sequence: one per method the plan lists. */
        final int count;
        final int minConfidence;

        Plan(boolean required, int count, int minConfidence) {
            this.required = required;
            this.count = Math.max(1, count);
            this.minConfidence = Math.max(0, Math.min(100, minConfidence));
        }

        /**
         * A missing or unreadable plan gets the web's defaults for an alarm:
         * a required check, one challenge, minConfidence 70 (models/Alarm.ts).
         * Never "no check": a plan that can't be read must not make an alarm
         * easier to stop than it was set to be.
         */
        static final Plan DEFAULT = new Plan(true, 1, 70);

        static Plan fromRingPlan(String ringPlanJson) {
            if (ringPlanJson == null) {
                return DEFAULT;
            }
            try {
                JSONObject challenge = new JSONObject(ringPlanJson).optJSONObject("challenge");
                if (challenge == null || !(challenge.opt("required") instanceof Boolean)) {
                    return DEFAULT;
                }
                JSONArray methods = challenge.optJSONArray("methods");
                return new Plan(challenge.getBoolean("required"),
                    methods == null ? 1 : methods.length(),
                    challenge.optInt("minConfidence", DEFAULT.minConfidence));
            }
            catch (JSONException e) {
                return DEFAULT;
            }
        }

        /** For several alarms ringing together: the strictest of their plans. */
        static Plan strictest(List<Plan> plans) {
            boolean required = false;
            int count = 1;
            int min = 0;
            for (Plan p : plans) {
                if (p.required) {
                    required = true;
                    count = Math.max(count, p.count);
                    min = Math.max(min, p.minConfidence);
                }
            }
            return required ? new Plan(true, count, min) : new Plan(false, 1, 0);
        }
    }

    enum Step {
        /** Wrong answer: a new problem, an attempt counted. */
        WRONG,
        /** Right answer, and there is another challenge in the sequence. */
        NEXT,
        /** All solved and the score meets minConfidence: dismiss. */
        PASSED,
        /** All solved but the score is below minConfidence: the sequence starts again. */
        RETRY,
    }

    private final Plan plan;
    private final Random random;
    private final List<WakeConfidence.Outcome> outcomes = new ArrayList<>();
    private MathChallenge current;
    private int totalAttempts;
    private int lastScore = -1;

    WakeCheck(Plan plan, Random random, long now) {
        this.plan = plan;
        this.random = random;
        current = new MathChallenge(random, now);
    }

    Plan plan() {
        return plan;
    }

    String question() {
        return current.question();
    }

    /** 1-based position in the sequence, for "Problem 2 of 3". */
    int position() {
        return outcomes.size() + 1;
    }

    /** The score of the last complete sequence, or -1 before there was one. */
    int lastScore() {
        return lastScore;
    }

    Step submit(String answer, long now) {
        if (!current.check(answer)) {
            current = current.next(random, now);
            return Step.WRONG;
        }
        outcomes.add(current.outcome(now));
        totalAttempts += current.wrongAnswers();
        if (outcomes.size() < plan.count) {
            current = new MathChallenge(random, now);
            return Step.NEXT;
        }
        WakeConfidence.Result r = WakeConfidence.accumulate(outcomes);
        lastScore = r.score;
        boolean allSolved = true;
        for (WakeConfidence.Outcome o : outcomes) {
            allSolved &= o.solved;
        }
        if (allSolved && WakeConfidence.meetsThreshold(r.score, plan.minConfidence)) {
            return Step.PASSED;
        }
        // As the web does: the next sequence is scored on its own.
        outcomes.clear();
        totalAttempts = 0;
        current = new MathChallenge(random, now);
        return Step.RETRY;
    }

    /** What the passed sequence showed, for the server's verify call. Only valid after PASSED. */
    Verification verification(long now) {
        long timeOnTask = 0;
        for (WakeConfidence.Outcome o : outcomes) {
            timeOnTask += (long) o.responseMs;
        }
        return new Verification(true, true, 1.0, timeOnTask, totalAttempts,
            Collections.nCopies(outcomes.size(), "math"), lastScore, now);
    }
}
