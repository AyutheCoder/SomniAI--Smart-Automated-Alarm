package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.WakeCheck.Plan;
import app.somniai.alarm.alarms.WakeCheck.Step;
import java.util.List;
import java.util.Random;
import org.junit.Test;

/** The native wake check: a wrong answer can never dismiss. */
public class WakeCheckTest {

    static String right(WakeCheck c) {
        String[] ab = c.question().split(" × ");
        return String.valueOf(Integer.parseInt(ab[0]) * Integer.parseInt(ab[1]));
    }

    static String wrong(WakeCheck c) {
        return String.valueOf(Integer.parseInt(right(c)) + 1);
    }

    @Test
    public void problemsAreTheWebsSixToThirteenTimesTables() {
        Random r = new Random(1);
        for (int i = 0; i < 2000; i++) {
            MathChallenge m = new MathChallenge(r, 0);
            assertTrue(m.a >= 6 && m.a <= 13 && m.b >= 6 && m.b <= 13);
            assertTrue(m.check(String.valueOf(m.a * m.b)));
            assertTrue("spaces are fine", m.check(" " + m.a * m.b + " "));
            assertFalse(m.check(String.valueOf(m.a * m.b + 1)));
            assertFalse(m.check(""));
            assertFalse(m.check(null));
            assertFalse(m.check("forty"));
            assertFalse(m.check(m.a * m.b + ".0"));
        }
    }

    @Test
    public void aWrongAnswerNeverDismissesHoweverManyAreGiven() {
        WakeCheck c = new WakeCheck(new Plan(true, 1, 0), new Random(7), 0);
        for (int i = 1; i <= 500; i++) {
            assertEquals(Step.WRONG, c.submit(wrong(c), i * 1000L));
        }
        // Even at minConfidence 0, only solving gets through.
        assertEquals(Step.PASSED, c.submit(right(c), 600_000));
    }

    @Test
    public void aQuickRightAnswerPassesTheDefaultCheck() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(3), 0);
        assertEquals(Step.PASSED, c.submit(right(c), 4_000));
        Verification v = c.verification(4_000);
        assertTrue(v.challenged);
        assertTrue(v.solved);
        assertEquals(1.0, v.correctness, 0);
        assertEquals(4_000, v.responseMs);
        assertEquals(0, v.attempts);
        assertEquals(List.of("math"), v.methods);
        assertTrue(v.score >= 70);
    }

    @Test
    public void everyChallengeInTheSequenceMustBeSolved() {
        WakeCheck c = new WakeCheck(new Plan(true, 3, 60), new Random(5), 0);
        assertEquals(Step.NEXT, c.submit(right(c), 2_000));
        assertEquals(2, c.position());
        assertEquals(Step.WRONG, c.submit(wrong(c), 3_000));
        assertEquals("a wrong answer doesn't advance", 2, c.position());
        assertEquals(Step.NEXT, c.submit(right(c), 5_000));
        assertEquals(Step.PASSED, c.submit(right(c), 7_000));
        Verification v = c.verification(7_000);
        assertEquals(List.of("math", "math", "math"), v.methods);
        assertEquals(1, v.attempts);
    }

    @Test
    public void solvedButTooSlowStartsAgainLikeTheWeb() {
        // 85 is the strictest tier; a minute and several wrong answers can't reach it.
        WakeCheck c = new WakeCheck(new Plan(true, 1, 85), new Random(11), 0);
        for (int i = 0; i < 4; i++) {
            c.submit(wrong(c), 10_000L * (i + 1));
        }
        assertEquals(Step.RETRY, c.submit(right(c), 60_000));
        assertTrue(c.lastScore() < 85);
        assertEquals(1, c.position());
        // A crisp second go passes, scored on its own.
        assertEquals(Step.PASSED, c.submit(right(c), 62_000));
        assertEquals(0, c.verification(62_000).attempts);
        assertEquals(2_000, c.verification(62_000).responseMs);
    }

    @Test
    public void theNativeScoreIsTheSharedModelsScore() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(2), 0);
        c.submit(wrong(c), 3_000);
        c.submit(right(c), 9_000);
        WakeConfidence.Result expected = WakeConfidence.accumulate(List.of(new WakeConfidence.Outcome(true, 9_000, 1, null, 2.0)));
        assertEquals(expected.score, c.lastScore());
    }

    @Test
    public void aWrongAnswerBringsANewProblem() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(9), 0);
        int changed = 0;
        for (int i = 0; i < 50; i++) {
            String before = c.question();
            c.submit(wrong(c), i);
            if (!before.equals(c.question())) {
                changed++;
            }
        }
        assertTrue("a wrong answer brings a new problem", changed > 40);
    }

    // --- the plan ---

    @Test
    public void thePlanComesFromTheRingPlan() {
        Plan p = Plan.fromRingPlan("{\"challenge\":{\"required\":true,\"methods\":[\"math\",\"typing\"],\"minConfidence\":78}}");
        assertTrue(p.required);
        assertEquals(2, p.count);
        assertEquals(78, p.minConfidence);
        assertFalse(Plan.fromRingPlan("{\"challenge\":{\"required\":false,\"methods\":[\"math\"],\"minConfidence\":70}}").required);
    }

    @Test
    public void anUnreadablePlanNeverMakesTheAlarmEasierToStop() {
        for (String plan : new String[] { null, "", "nope", "{}", "{\"challenge\":{}}", "{\"challenge\":{\"required\":\"no\"}}" }) {
            Plan p = Plan.fromRingPlan(plan);
            assertTrue(plan, p.required);
            assertEquals(plan, 70, p.minConfidence);
        }
    }

    @Test
    public void severalAlarmsTakeTheStrictestPlan() {
        Plan p = Plan.strictest(List.of(new Plan(false, 1, 0), new Plan(true, 1, 60), new Plan(true, 3, 85)));
        assertTrue(p.required);
        assertEquals(3, p.count);
        assertEquals(85, p.minConfidence);
        assertFalse(Plan.strictest(List.of(new Plan(false, 1, 0), new Plan(false, 2, 90))).required);
        assertNotEquals(0, new Plan(true, 0, 150).count);
        assertEquals(100, new Plan(true, 0, 150).minConfidence);
    }
}
