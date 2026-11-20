package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.WakeConfidence.Outcome;
import app.somniai.alarm.alarms.WakeConfidence.Result;
import app.somniai.alarm.alarms.WakeConfidence.Signals;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The native gate, against the same cases as lib/wakeConfidence.test.ts
 * (restated one for one, same names), plus the shared table of 3,456 signal
 * combinations and 12 sequences that lib/wakeConfidence.parity.test.ts checks
 * against the TypeScript.
 */
public class WakeConfidenceTest {

    static final int[] SCHEDULER_THRESHOLDS = { 60, 70, 78, 85 };
    static final int LOWEST_THRESHOLD = 60;

    static Signals sig(double correctness, double responseMs, double attempts, Double motion, Double interactions) {
        return new Signals(correctness, responseMs, attempts, motion, interactions, null);
    }

    static Outcome solve() {
        return new Outcome(true, 4000, 1, 0.6, 3.0);
    }

    static Outcome solve(boolean solved, double responseMs, double attempts, Double motion) {
        return new Outcome(solved, responseMs, attempts, motion, 3.0);
    }

    // --- the unsolved-challenge gate ---

    @Test
    public void keepsTheCeilingBelowEveryThresholdTheSchedulerCanAssign() {
        assertTrue(WakeConfidence.UNSOLVED_CEILING < LOWEST_THRESHOLD);
    }

    @Test
    public void capsTheBestPossibleUnsolvedAttemptAtTheCeiling() {
        Result r = WakeConfidence.compute(sig(0, 0, 1, 1.0, 100.0));
        assertTrue(r.score <= WakeConfidence.UNSOLVED_CEILING);
        for (int t : SCHEDULER_THRESHOLDS) {
            assertFalse(WakeConfidence.meetsThreshold(r.score, t));
        }
    }

    @Test
    public void cannotReachAnyAlarmThresholdAcrossTheWholeUnsolvedSignalSpace() {
        int worst = 0;
        for (double responseMs : new double[] { 0, 1000, 6000, 20000, 45000, 90000 }) {
            for (double attempts : new double[] { 0, 1, 2, 5, 20 }) {
                for (Double motion : new Double[] { null, 0.0, 0.5, 1.0, 5.0 }) {
                    for (double interactions : new double[] { 0, 1, 6, 50 }) {
                        int score = WakeConfidence.compute(sig(0, responseMs, attempts, motion, interactions)).score;
                        worst = Math.max(worst, score);
                        assertTrue(score <= WakeConfidence.UNSOLVED_CEILING);
                        assertFalse(WakeConfidence.meetsThreshold(score, LOWEST_THRESHOLD));
                    }
                }
            }
        }
        assertTrue(worst < WakeConfidence.UNSOLVED_CEILING);
    }

    @Test
    public void gatesAPartiallyCorrectSequenceThatWouldOtherwisePass() {
        Result r = WakeConfidence.accumulate(List.of(solve(), solve(), solve(), solve(false, 4000, 1, 0.6)));
        assertTrue(r.gated);
        assertTrue(r.score <= WakeConfidence.UNSOLVED_CEILING);
        assertFalse(WakeConfidence.meetsThreshold(r.score, LOWEST_THRESHOLD));
    }

    @Test
    public void flagsGatedOnlyWhenTheCapActuallyChangedTheOutcome() {
        Result hopeless = WakeConfidence.compute(sig(0, 45000, 8, 0.0, 0.0));
        assertFalse(hopeless.gated);
        assertTrue(hopeless.score < WakeConfidence.UNSOLVED_CEILING);
    }

    @Test
    public void treatsAnExplicitSolvedFalseAsAuthoritativeOverCorrectness() {
        Result r = WakeConfidence.compute(new Signals(1, 2000, 1, 1.0, 10.0, false));
        assertTrue(r.score <= WakeConfidence.UNSOLVED_CEILING);
    }

    // --- discrimination among correct answers ---

    @Test
    public void scoresACrispSolveNearTheTopOfTheRange() {
        Result r = WakeConfidence.compute(sig(1, 3000, 1, 0.8, 5.0));
        assertTrue(r.score >= 90);
        assertFalse(r.gated);
    }

    @Test
    public void scoresAFumbledSolveFarLower() {
        Result r = WakeConfidence.compute(sig(1, 40000, 4, 0.1, 1.0));
        assertTrue(r.score < 60);
        assertTrue(r.score > WakeConfidence.UNSOLVED_CEILING);
    }

    @Test
    public void keepsEverySchedulerTierBothReachableAndFailable() {
        int best = WakeConfidence.compute(sig(1, 0, 1, 1.0, 6.0)).score;
        int worst = WakeConfidence.compute(sig(1, 45000, 6, 0.0, 0.0)).score;
        for (int t : SCHEDULER_THRESHOLDS) {
            assertTrue(best >= t);
            assertTrue(worst < t);
        }
    }

    @Test
    public void rewardsSpeedPenalisesRepeatedAttemptsAndReadsStillnessAsSleepiness() {
        assertTrue(WakeConfidence.compute(sig(1, 2000, 1, 0.5, 3.0)).score > WakeConfidence.compute(sig(1, 30000, 1, 0.5, 3.0)).score);
        assertTrue(WakeConfidence.compute(sig(1, 8000, 1, 0.5, 3.0)).score > WakeConfidence.compute(sig(1, 8000, 5, 0.5, 3.0)).score);
        assertTrue(WakeConfidence.compute(sig(1, 8000, 1, 0.9, 3.0)).score > WakeConfidence.compute(sig(1, 8000, 1, 0.05, 3.0)).score);
    }

    @Test
    public void treatsUnknownMotionAsUninformativeRatherThanAsCredit() {
        // Unknown motion contributes nothing: the same as motion exactly 0.5.
        assertEquals(WakeConfidence.compute(sig(1, 5000, 1, 0.5, 2.0)).score, WakeConfidence.compute(sig(1, 5000, 1, null, 2.0)).score);
    }

    @Test
    public void doesNotPenaliseTheFirstAttempt() {
        assertEquals(WakeConfidence.compute(sig(1, 5000, 0, null, null)).score, WakeConfidence.compute(sig(1, 5000, 1, null, null)).score);
    }

    // --- multi-challenge evidence accumulation ---

    @Test
    public void requiresEveryChallengeInTheSequenceToLand() {
        Result r = WakeConfidence.accumulate(List.of(solve(), solve(false, 4000, 1, 0.6)));
        assertTrue(r.gated);
        assertTrue(r.score <= WakeConfidence.UNSOLVED_CEILING);
    }

    @Test
    public void passesAFullySolvedSequenceWellClearOfTheThresholds() {
        Result r = WakeConfidence.accumulate(List.of(solve(), solve()));
        assertFalse(r.gated);
        assertTrue(WakeConfidence.meetsThreshold(r.score, LOWEST_THRESHOLD));
    }

    @Test
    public void sumsTimeOnTaskSoALongFumbleStaysVisible() {
        int quick = WakeConfidence.accumulate(List.of(solve(true, 3000, 1, 0.6), solve(true, 3000, 1, 0.6))).score;
        int slow = WakeConfidence.accumulate(List.of(solve(true, 20000, 1, 0.6), solve(true, 20000, 1, 0.6))).score;
        assertTrue(slow < quick);
    }

    @Test
    public void sumsAttemptsAcrossTheSequence() {
        int clean = WakeConfidence.accumulate(List.of(solve(true, 4000, 1, 0.6), solve(true, 4000, 1, 0.6))).score;
        int messy = WakeConfidence.accumulate(List.of(solve(true, 4000, 3, 0.6), solve(true, 4000, 3, 0.6))).score;
        assertTrue(messy < clean);
    }

    @Test
    public void scoresAnEmptySequenceAsAnUnsolvedChallenge() {
        Result r = WakeConfidence.accumulate(List.of());
        assertTrue(r.score <= WakeConfidence.UNSOLVED_CEILING);
        assertFalse(WakeConfidence.meetsThreshold(r.score, LOWEST_THRESHOLD));
    }

    @Test
    public void averagesMotionAcrossChallengesThatReportedItIgnoringThoseThatDidNot() {
        // The single reading stands (0.9), not diluted to 0.45.
        int mixed = WakeConfidence.accumulate(List.of(solve(true, 4000, 1, 0.9), solve(true, 4000, 1, null))).score;
        int both = WakeConfidence.accumulate(List.of(solve(true, 4000, 1, 0.9), solve(true, 4000, 1, 0.9))).score;
        assertEquals(both, mixed);
    }

    @Test
    public void currentlyScoresALongerPerfectSequenceNoHigherThanAShortOne() {
        int single = WakeConfidence.accumulate(List.of(solve())).score;
        int dbl = WakeConfidence.accumulate(List.of(solve(), solve())).score;
        assertTrue(dbl <= single);
    }

    // --- the shared table ---

    @Test
    public void agreesWithTheTypeScriptOnEveryCaseInTheSharedTable() throws Exception {
        JSONObject table = new JSONObject(new String(Files.readAllBytes(new File("src/test/resources/wake-confidence-cases.json").toPath()), "UTF-8"));
        JSONArray signals = table.getJSONArray("signals");
        int checked = 0;
        for (int i = 0; i < signals.length(); i++) {
            JSONObject c = signals.getJSONObject(i);
            JSONObject in = c.getJSONObject("in");
            Result r = WakeConfidence.compute(new Signals(
                in.getDouble("correctness"), in.getDouble("responseMs"), in.getDouble("attempts"),
                in.has("motion") ? in.getDouble("motion") : null,
                in.has("interactions") ? in.getDouble("interactions") : null,
                in.has("solved") ? in.getBoolean("solved") : null,
                in.has("steps") ? in.getDouble("steps") : null));
            assertEquals("signals " + in, c.getInt("score"), r.score);
            assertEquals("signals " + in, c.getBoolean("gated"), r.gated);
            checked++;
        }
        JSONArray sequences = table.getJSONArray("sequences");
        for (int i = 0; i < sequences.length(); i++) {
            JSONObject c = sequences.getJSONObject(i);
            JSONArray in = c.getJSONArray("in");
            List<Outcome> outcomes = new ArrayList<>();
            for (int k = 0; k < in.length(); k++) {
                JSONObject o = in.getJSONObject(k);
                outcomes.add(new Outcome(o.getBoolean("solved"), o.getDouble("responseMs"), o.getDouble("attempts"),
                    o.has("motion") ? o.getDouble("motion") : null,
                    o.has("interactions") ? o.getDouble("interactions") : null,
                    o.has("steps") ? o.getDouble("steps") : null));
            }
            Result r = WakeConfidence.accumulate(outcomes);
            assertEquals("sequence " + in, c.getInt("score"), r.score);
            assertEquals("sequence " + in, c.getBoolean("gated"), r.gated);
            checked++;
        }
        // 140 signals and 5 sequences with several answers per responseMs (three sums).
        assertEquals(3456 + 140 + 12 + 5, checked);
    }
}
