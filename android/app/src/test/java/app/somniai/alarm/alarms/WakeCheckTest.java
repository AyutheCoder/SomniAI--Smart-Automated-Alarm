package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.WakeCheck.Plan;
import app.somniai.alarm.alarms.WakeCheck.Step;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.Test;

/** The native wake check: a wrong answer can never dismiss. */
public class WakeCheckTest {

    /** Works out the sum on screen, "4 × 7 + 6 × 9". */
    static String right(WakeCheck c) {
        int total = 0;
        for (String product : c.question().split(" [+] ")) {
            String[] ab = product.split(" × ");
            total += Integer.parseInt(ab[0]) * Integer.parseInt(ab[1]);
        }
        return String.valueOf(total);
    }

    static String wrong(WakeCheck c) {
        return String.valueOf(Integer.parseInt(right(c)) + 1);
    }

    @Test
    public void sumsAreTheWebsTwoToNineTimesThreeToTwelveTwice() {
        Random r = new Random(1);
        Set<Integer> as = new HashSet<>();
        Set<Integer> bs = new HashSet<>();
        for (int i = 0; i < 5000; i++) {
            MathChallenge m = new MathChallenge(r);
            assertTrue(m.a >= 2 && m.a <= 9 && m.c >= 2 && m.c <= 9);
            assertTrue(m.b >= 3 && m.b <= 12 && m.d >= 3 && m.d <= 12);
            as.add(m.a);
            as.add(m.c);
            bs.add(m.b);
            bs.add(m.d);
            int answer = m.a * m.b + m.c * m.d;
            assertEquals(m.a + " × " + m.b + " + " + m.c + " × " + m.d, m.question());
            assertTrue(m.check(String.valueOf(answer)));
            assertTrue("spaces are fine", m.check(" " + answer + " "));
            assertFalse(m.check(String.valueOf(answer + 1)));
            assertFalse(m.check(""));
            assertFalse(m.check(null));
            assertFalse(m.check("forty"));
            assertFalse(m.check(answer + ".0"));
        }
        assertEquals("every first number reached", 8, as.size());
        assertEquals("every second number reached", 10, bs.size());
        assertEquals(3, MathChallenge.SUMS);
    }

    @Test
    public void aWrongAnswerNeverDismissesHoweverManyAreGiven() {
        WakeCheck c = new WakeCheck(new Plan(true, 1, 0), new Random(7), 0);
        for (int i = 1; i <= 500; i++) {
            assertEquals(Step.WRONG, c.submit(wrong(c), i * 1000L));
        }
        // Even at minConfidence 0, only solving all three gets through.
        assertEquals(Step.NEXT, c.submit(right(c), 600_000));
        assertEquals(Step.NEXT, c.submit(right(c), 601_000));
        assertEquals(Step.PASSED, c.submit(right(c), 602_000));
    }

    @Test
    public void threeRightSumsInARowPassTheDefaultCheck() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(3), 0);
        assertEquals(3, c.sums());
        assertEquals(1, c.position());
        assertEquals(Step.NEXT, c.submit(right(c), 10_000));
        assertEquals(2, c.position());
        assertEquals(Step.NEXT, c.submit(right(c), 20_000));
        assertEquals(3, c.position());
        assertEquals(Step.PASSED, c.submit(right(c), 30_000));
        Verification v = c.verification(30_000);
        assertTrue(v.challenged);
        assertTrue(v.solved);
        assertEquals(1.0, v.correctness, 0);
        assertEquals("time on task, all three sums", 30_000, v.responseMs);
        assertEquals("three answers", 3, v.steps);
        assertEquals(0, v.attempts);
        assertEquals(List.of("math"), v.methods);
        assertTrue(v.score >= 70);
    }

    /**
     * Found by the on-device test: the ring screen hands the result to the
     * service as JSON, which dropped the sum count, so the server judged three
     * sums as one slow answer.
     */
    @Test
    public void theSumCountSurvivesTheHandOverToTheService() throws Exception {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(6), 0);
        c.submit(right(c), 10_000);
        c.submit(right(c), 20_000);
        c.submit(right(c), 30_000);
        Verification back = Verification.fromJson(c.verification(30_000).toJson().toString());
        assertEquals(3, back.steps);
        assertEquals(30_000, back.responseMs);
        org.json.JSONObject verify = SyncCalls.forRing("a1", 0, "dismissed", 31_000, back, 4, List.of()).get(1).body;
        assertEquals(3, verify.getInt("steps"));

        // A result queued by the previous version has no count: one answer per challenge, as it was.
        Verification old = Verification.fromJson("{\"challenged\":true,\"solved\":true,\"correctness\":1,\"responseMs\":9000,"
            + "\"attempts\":0,\"methods\":[\"math\",\"math\"],\"score\":88,\"at\":5}");
        assertEquals(2, old.steps);
    }

    @Test
    public void aWrongAnswerDoesntUndoTheSumsAlreadySolved() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(4), 0);
        assertEquals(Step.NEXT, c.submit(right(c), 5_000));
        assertEquals(Step.WRONG, c.submit(wrong(c), 9_000));
        assertEquals("still on the second sum", 2, c.position());
        assertEquals(Step.NEXT, c.submit(right(c), 14_000));
        assertEquals(Step.PASSED, c.submit(right(c), 20_000));
        assertEquals(1, c.verification(20_000).attempts);
    }

    @Test
    public void everyChallengeInTheSequenceMustBeSolved() {
        WakeCheck c = new WakeCheck(new Plan(true, 2, 60), new Random(5), 0);
        assertEquals("three sums per challenge", 6, c.sums());
        for (int i = 1; i <= 5; i++) {
            assertEquals(Step.NEXT, c.submit(right(c), i * 2_000L));
            assertEquals(i + 1, c.position());
        }
        assertEquals(Step.WRONG, c.submit(wrong(c), 11_000));
        assertEquals("a wrong answer doesn't advance", 6, c.position());
        assertEquals(Step.PASSED, c.submit(right(c), 13_000));
        Verification v = c.verification(13_000);
        assertEquals(List.of("math", "math"), v.methods);
        assertEquals(6, v.steps);
        assertEquals(1, v.attempts);
        assertEquals(13_000, v.responseMs);
    }

    @Test
    public void solvedButTooSlowStartsAgainLikeTheWeb() {
        // 85 is the strictest tier; five minutes and four wrong answers can't reach it.
        WakeCheck c = new WakeCheck(new Plan(true, 1, 85), new Random(11), 0);
        for (int i = 0; i < 4; i++) {
            c.submit(wrong(c), 30_000L * (i + 1));
        }
        c.submit(right(c), 200_000);
        c.submit(right(c), 250_000);
        assertEquals(Step.RETRY, c.submit(right(c), 300_000));
        assertTrue(c.lastScore() < 85);
        assertEquals("starts again from the first sum", 1, c.position());
        // A crisp second go passes, scored on its own.
        c.submit(right(c), 302_000);
        c.submit(right(c), 304_000);
        assertEquals(Step.PASSED, c.submit(right(c), 306_000));
        assertEquals(0, c.verification(306_000).attempts);
        assertEquals(6_000, c.verification(306_000).responseMs);
    }

    @Test
    public void threeGroggySumsStillPassTheStrictestTier() {
        // 25 s a sum: judged per sum, not as one 75-second answer.
        WakeCheck c = new WakeCheck(new Plan(true, 1, 85), new Random(12), 0);
        c.submit(right(c), 25_000);
        c.submit(right(c), 50_000);
        assertEquals(Step.PASSED, c.submit(right(c), 75_000));
    }

    @Test
    public void theNativeScoreIsTheSharedModelsScore() {
        WakeCheck c = new WakeCheck(Plan.DEFAULT, new Random(2), 0);
        c.submit(wrong(c), 3_000);
        c.submit(right(c), 9_000);
        c.submit(right(c), 15_000);
        c.submit(right(c), 24_000);
        // One wrong answer, four answers in all, three sums.
        WakeConfidence.Result expected = WakeConfidence.accumulate(List.of(new WakeConfidence.Outcome(true, 24_000, 1, null, 4.0, 3.0)));
        assertEquals(expected.score, c.lastScore());
    }

    @Test
    public void everyAnswerBringsANewSum() {
        WakeCheck c = new WakeCheck(new Plan(true, 50, 0), new Random(9), 0);
        int changed = 0;
        for (int i = 0; i < 50; i++) {
            String before = c.question();
            c.submit(i % 2 == 0 ? wrong(c) : right(c), i);
            if (!before.equals(c.question())) {
                changed++;
            }
        }
        assertTrue("right or wrong, the next sum is a new one", changed > 45);
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
