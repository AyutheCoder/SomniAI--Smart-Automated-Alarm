package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.RingController.Source;
import app.somniai.alarm.alarms.RingController.State;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

/**
 * The ring service's lifecycle, through a fake that records every effect and
 * tracks what is held. Each way a ring ends must leave nothing held.
 */
public class RingControllerTest {

    static final RingTuning.Settings TUNING = RingTuning.settings("aggressive", 100);

    /** Records effects in order and tracks what is currently held. */
    static final class Fake implements RingController.Effects {
        final List<String> calls = new ArrayList<>();
        final List<String> records = new ArrayList<>();
        final List<Float> volumes = new ArrayList<>();
        Set<Source> playable = EnumSet.allOf(Source.class);
        boolean foregroundAllowed = true;
        boolean foreground, wakeLock, raised, sound, vibrating, tickPending, serviceRunning = true, screenOpen = true;
        long wakeLockTimeout;

        @Override public boolean startForeground(RingController.Alarm first) { calls.add("startForeground"); foreground = foregroundAllowed; return foregroundAllowed; }
        @Override public void showAlarms(Iterable<RingController.Alarm> ringing) { calls.add("showAlarms"); }
        @Override public void acquireWakeLock(long timeoutMs) { calls.add("acquireWakeLock"); wakeLock = true; wakeLockTimeout = timeoutMs; }
        @Override public void releaseWakeLock() { calls.add("releaseWakeLock"); wakeLock = false; }
        double factor;
        int pulses;
        int challenges;
        final List<Integer> levels = new ArrayList<>();
        final List<List<String>> backupsTried = new ArrayList<>();
        @Override public void raiseAlarmVolume(double f) { calls.add("raiseAlarmVolume"); raised = true; factor = f; }
        @Override public void pulse() { pulses++; }
        @Override public void showLevel(EscalationLadder.Level l) { levels.add(l.level); }
        @Override public void promptChallenge() { challenges++; }
        final List<String> backupsFor = new ArrayList<>();
        final List<String> backupStops = new ArrayList<>();
        @Override public void requestBackups(RingController.Alarm a, List<String> kinds) { backupsTried.add(kinds); backupsFor.add(a.id); }
        @Override public void stopBackupRing(RingController.Alarm a) { backupStops.add(a.id); }
        @Override public void restoreAlarmVolume() { calls.add("restoreAlarmVolume"); raised = false; }
        @Override public boolean startSound(Source s) { calls.add("startSound " + s); sound = playable.contains(s); return sound; }
        @Override public void setVolume(float v) { volumes.add(v); }
        @Override public void stopSound() { calls.add("stopSound"); sound = false; }
        @Override public void startVibration() { calls.add("startVibration"); vibrating = true; }
        @Override public void stopVibration() { calls.add("stopVibration"); vibrating = false; }
        @Override public void scheduleTick(long delayMs) { tickPending = true; }
        @Override public void cancelTicks() { calls.add("cancelTicks"); tickPending = false; }
        @Override public void closeRingScreen() { calls.add("closeRingScreen"); screenOpen = false; }
        @Override public void stopService() { calls.add("stopService"); serviceRunning = false; foreground = false; }
        @Override public void record(RingController.Alarm a, String outcome, long at, String detail) { records.add(a.id + " " + outcome); }
        final List<String> queued = new ArrayList<>();
        @Override public void queueSync(RingController.Alarm a, long rangAt, String outcome, long endedAt, Verification v, int level, List<Backups.Outcome> b) {
            queued.add(a.id + " " + outcome + " rang " + rangAt + " ended " + endedAt + (v == null ? "" : v.challenged ? " checked" : " unchecked")
                + " level " + level + (b.isEmpty() ? "" : " backups " + b.size()));
        }

        void assertNothingHeld() {
            assertFalse("wake lock", wakeLock);
            assertFalse("alarm volume left raised", raised);
            assertFalse("sound", sound);
            assertFalse("vibration", vibrating);
            assertFalse("tick", tickPending);
        }
    }

    static final WakeCheck.Plan NO_CHECK = new WakeCheck.Plan(false, 1, 0);

    static RingController.Alarm alarm(String id) {
        return new RingController.Alarm(id, "Gym", 1_000, NO_CHECK, EscalationLadder.fromRingPlan(null));
    }

    static RingController.Alarm checked(String id, int count, int min) {
        return new RingController.Alarm(id, "Gym", 1_000, new WakeCheck.Plan(true, count, min), EscalationLadder.fromRingPlan(null));
    }

    static Verification passed(int count, int score) {
        return new Verification(true, true, 1, 8_000, 0, java.util.Collections.nCopies(count, "math"), score, 30_000);
    }

    @Test
    public void startGoesForegroundFirstThenRings() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertEquals(State.RINGING, c.state());
        assertEquals("Android requires startForeground within seconds of the start", "startForeground", fx.calls.get(0));
        assertTrue(fx.foreground);
        assertTrue(fx.wakeLock);
        assertTrue("held past the longest ring", fx.wakeLockTimeout > RingTuning.MAX_RING_MS);
        assertTrue(fx.raised);
        assertTrue(fx.sound);
        assertEquals(Source.ALARM_SOUND, c.source());
        // Level 1 of the ladder doesn't vibrate: one buzz now, continuous from the vibration level.
        assertFalse(fx.vibrating);
        assertEquals(1, fx.pulses);
        assertTrue(fx.tickPending);
        assertEquals(List.of("a ringing"), fx.records);
        assertTrue("the wake lock is taken before the sound starts",
            fx.calls.indexOf("acquireWakeLock") < fx.calls.indexOf("startSound ALARM_SOUND"));
    }

    @Test
    public void dismissStopsCleanly() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertTrue(c.dismiss(42_000, Verification.none(42_000)));
        assertEquals(State.STOPPED, c.state());
        fx.assertNothingHeld();
        assertFalse(fx.serviceRunning);
        assertFalse(fx.foreground);
        assertFalse(fx.screenOpen);
        assertEquals(List.of("a ringing", "a dismissed"), fx.records);
    }

    @Test
    public void dismissIsIdempotentAndHarmlessWhenNothingRings() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        assertFalse("nothing ringing yet", c.dismiss(0, Verification.none(0)));
        assertTrue(fx.records.isEmpty());
        c.start(alarm("a"), TUNING, 0);
        assertTrue(c.dismiss(1_000, Verification.none(1_000)));
        assertFalse(c.dismiss(2_000, Verification.none(2_000)));
        assertEquals("one outcome per ring", List.of("a ringing", "a dismissed"), fx.records);
    }

    @Test
    public void theRampRisesThenHoldsAtTheTarget() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        for (long t = RingTuning.TICK_MS; t <= 15_000; t += RingTuning.TICK_MS) {
            c.tick(t);
        }
        for (int i = 1; i < fx.volumes.size(); i++) {
            assertTrue("never quieter", fx.volumes.get(i) >= fx.volumes.get(i - 1));
        }
        assertTrue(fx.volumes.get(0) < 0.05f);
        assertEquals(TUNING.target, fx.volumes.get(fx.volumes.size() - 1), 1e-6);
    }

    @Test
    public void unansweredStopsAfterTheLimitAndSaysSo() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.tick(RingTuning.MAX_RING_MS - 1);
        assertEquals(State.RINGING, c.state());
        c.tick(RingTuning.MAX_RING_MS);
        assertEquals(State.STOPPED, c.state());
        fx.assertNothingHeld();
        assertFalse(fx.serviceRunning);
        // Its first tick was already past every level: straight to the top, backups asked for once
        // (recorded when the server answers, which it hasn't here).
        assertEquals(List.of("a ringing", "a escalated", "a unanswered"), fx.records);
        assertEquals(1, fx.backupsTried.size());
    }

    @Test
    public void aSecondAlarmJoinsAndOneDismissalStopsBoth() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        int soundStarts = (int) fx.calls.stream().filter(s -> s.startsWith("startSound")).count();
        c.start(alarm("b"), TUNING, 5_000);
        c.start(alarm("b"), TUNING, 5_500);
        assertEquals("no restart of the sound", soundStarts, fx.calls.stream().filter(s -> s.startsWith("startSound")).count());
        assertTrue(fx.calls.contains("showAlarms"));
        c.dismiss(9_000, Verification.none(9_000));
        assertEquals(List.of("a ringing", "b ringing", "a dismissed", "b dismissed"), fx.records);
        fx.assertNothingHeld();
    }

    @Test
    public void destroyedWhileRingingReleasesEverythingAndRecordsIt() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.destroyed(3_000);
        fx.assertNothingHeld();
        assertEquals(List.of("a ringing", "a interrupted"), fx.records);
        c.destroyed(4_000);
        assertEquals("a second destroy adds nothing", 2, fx.records.size());
    }

    @Test
    public void destroyedAfterDismissalRecordsNothingMore() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.dismiss(1_000, Verification.none(1_000));
        c.destroyed(1_100);
        assertEquals(List.of("a ringing", "a dismissed"), fx.records);
    }

    @Test
    public void soundSourcesAreTriedInOrder() {
        Fake fx = new Fake();
        fx.playable = EnumSet.of(Source.TONE);
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertEquals(Source.TONE, c.source());
        assertEquals(List.of("startSound ALARM_SOUND", "startSound RINGTONE", "startSound TONE"),
            fx.calls.stream().filter(s -> s.startsWith("startSound")).collect(java.util.stream.Collectors.toList()));
    }

    @Test
    public void aSoundThatFailsWhileRingingFallsBackToTheNext() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.soundFailed(2_000);
        assertEquals(Source.RINGTONE, c.source());
        c.soundFailed(3_000);
        assertEquals(Source.TONE, c.source());
        assertTrue(fx.sound);
        assertEquals(State.RINGING, c.state());
        assertTrue(fx.records.contains("a sound_failed"));
    }

    @Test
    public void withNoPlayableSoundItStillVibratesAndSaysSo() {
        Fake fx = new Fake();
        fx.playable = EnumSet.noneOf(Source.class);
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertNull(c.source());
        assertTrue(fx.vibrating);
        assertEquals(State.RINGING, c.state());
        c.dismiss(1_000, Verification.none(1_000));
        fx.assertNothingHeld();
    }

    @Test
    public void refusedForegroundStillRings() {
        Fake fx = new Fake();
        fx.foregroundAllowed = false;
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertTrue(fx.sound);
        assertEquals(1, fx.pulses);
        c.dismiss(1_000, Verification.none(1_000));
        fx.assertNothingHeld();
    }

    @Test
    public void ringsAgainAfterAnEarlierRingEnded() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.dismiss(1_000, Verification.none(1_000));
        c.start(alarm("b"), TUNING, 60_000);
        assertEquals(State.RINGING, c.state());
        assertTrue(fx.sound);
        c.dismiss(61_000, Verification.none(61_000));
        assertEquals(List.of("a ringing", "a dismissed", "b ringing", "b dismissed"), fx.records);
        fx.assertNothingHeld();
    }

    @Test
    public void aRingThatNeedsAWakeCheckRefusesEveryDismissalWithoutAPassedOne() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(checked("a", 2, 78), TUNING, 0);
        Verification unsolved = new Verification(true, false, 0.5, 8_000, 3, List.of("math", "math"), 30, 9_000);
        for (Verification v : new Verification[] {
            null,
            Verification.none(1_000),
            unsolved,
            passed(1, 95),   // too few challenges
            passed(2, 77),   // below minConfidence
        }) {
            assertFalse(c.dismiss(10_000, v));
            assertEquals(State.RINGING, c.state());
            assertTrue("still ringing", fx.sound && fx.wakeLock);
        }
        assertTrue(fx.queued.isEmpty());
        assertEquals(5, fx.records.stream().filter(r -> r.endsWith("dismiss_refused")).count());
        assertTrue(c.dismiss(11_000, passed(2, 78)));
        assertEquals(State.STOPPED, c.state());
        fx.assertNothingHeld();
    }

    @Test
    public void anUnsolvedCheckNeverStopsTheRingWhateverScoreItClaims() {
        // As the server's "never passes an unsolved challenge, whatever score is claimed".
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(checked("a", 2, 60), TUNING, 0);
        Verification unsolvedHighScore = new Verification(true, false, 1.0, 3_000, 0, List.of("math", "math"), 99, 9_000);
        Verification partlyWrongHighScore = new Verification(true, true, 0.5, 3_000, 0, List.of("math", "math"), 99, 9_000);
        assertFalse(c.dismiss(10_000, unsolvedHighScore));
        assertFalse(c.dismiss(10_000, partlyWrongHighScore));
        assertEquals(State.RINGING, c.state());
        assertTrue(fx.queued.isEmpty());
    }

    @Test
    public void theStrictestPlanOfTheAlarmsRingingDecides() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("easy"), TUNING, 0);
        c.start(checked("hard", 1, 85), TUNING, 1_000);
        assertFalse(c.dismiss(2_000, Verification.none(2_000)));
        assertFalse(c.dismiss(2_000, passed(1, 80)));
        assertTrue(c.dismiss(2_000, passed(1, 85)));
    }

    @Test
    public void aDismissalIsQueuedForTheServerWithItsCheck() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 100);
        Verification passed = new Verification(true, true, 1, 8_000, 0, List.of("math"), 91, 30_000);
        c.dismiss(31_000, passed);
        assertEquals(List.of("a dismissed rang 100 ended 31000 checked level 1"), fx.queued);
    }

    @Test
    public void eachJoinedAlarmIsQueuedWithWhenItStartedRinging() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.start(alarm("b"), TUNING, 5_000);
        c.dismiss(9_000, Verification.none(9_000));
        assertEquals(List.of("a dismissed rang 0 ended 9000 unchecked level 1", "b dismissed rang 5000 ended 9000 unchecked level 1"), fx.queued);
    }

    @Test
    public void anUnansweredRingIsQueuedWithoutAVerification() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.tick(RingTuning.MAX_RING_MS);
        assertEquals(List.of("a unanswered rang 0 ended " + RingTuning.MAX_RING_MS + " level 1"), fx.queued);
    }

    @Test
    public void anInterruptedRingIsNotQueuedBecauseItRingsAgain() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.destroyed(1_000);
        assertTrue(fx.queued.isEmpty());
    }

    // --- the escalation ladder (prompt 2.6) ---

    /** An alarm whose ring plan has this adaptive ladder from the TypeScript table, marked critical or not. */
    static RingController.Alarm withLadder(String id, String profile, boolean critical, boolean check) throws Exception {
        org.json.JSONArray cases = new org.json.JSONObject(new String(java.nio.file.Files.readAllBytes(
            new java.io.File("src/test/resources/escalation-cases.json").toPath()), "UTF-8")).getJSONArray("personalised");
        org.json.JSONArray ladder = null;
        for (int i = 0; i < cases.length(); i++) {
            org.json.JSONObject c = cases.getJSONObject(i);
            if (c.getString("strategy").equals("adaptive") && c.getString("profile").equals(profile) && !c.getBoolean("critical")) {
                ladder = c.getJSONArray("plan");
            }
        }
        String plan = new org.json.JSONObject().put("critical", critical).put("escalation", ladder)
            .put("sound", new org.json.JSONObject().put("strategy", "adaptive").put("intensity", 60)).toString();
        return new RingController.Alarm(id, "Gym", 1_000, check ? new WakeCheck.Plan(true, 1, 70) : NO_CHECK, EscalationLadder.fromRingPlan(plan));
    }

    static RingController.Alarm standardChecked(String id) {
        return new RingController.Alarm(id, "Gym", 1_000, new WakeCheck.Plan(true, 1, 70), EscalationLadder.fromRingPlan(null));
    }

    /** Ticks every 500 ms from {@code from} up to and including {@code to}. */
    static void tickTo(RingController c, long from, long to) {
        for (long t = from; t <= to; t += RingTuning.TICK_MS) {
            c.tick(t);
        }
    }

    @Test
    public void eachStageArrivesAtItsTimeAndOnlyOnce() {
        // The standard adaptive ladder: 0, 10, 22, 35, 75 s.
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(standardChecked("a"), TUNING, 0);
        assertEquals(List.of(1), fx.levels);
        assertEquals(1.0, fx.factor, 0);

        tickTo(c, 500, 9_500);
        assertEquals("nothing before 10 s", List.of(1), fx.levels);
        c.tick(10_000);
        assertEquals(2, c.level().level);
        assertEquals("louder: the stream for factor 1.4", 1.4, fx.factor, 0);

        tickTo(c, 10_500, 21_500);
        assertFalse("no continuous vibration before its level", fx.vibrating);
        c.tick(22_000);
        assertEquals(3, c.level().level);
        assertTrue("continuous vibration from level 3", fx.vibrating);
        assertEquals(0, fx.challenges);

        tickTo(c, 22_500, 34_500);
        c.tick(35_000);
        assertEquals(4, c.level().level);
        assertEquals("the wake check is put in front of the user", 1, fx.challenges);
        assertTrue(fx.backupsTried.isEmpty());

        tickTo(c, 35_500, 74_500);
        assertTrue("no backups before 75 s", fx.backupsTried.isEmpty());
        c.tick(75_000);
        assertEquals(5, c.level().level);
        assertEquals("every channel, once", List.of(EscalationLadder.BACKUP_KINDS), fx.backupsTried);
        assertFalse("asked, not yet answered: nothing claimed", fx.records.contains("a backups"));
        c.onBackups(Backups.failedAll(EscalationLadder.BACKUP_KINDS, "couldn't reach the server"), 76_000);
        assertTrue(fx.records.contains("a backups"));

        tickTo(c, 75_500, 300_000);
        assertEquals("never twice", 1, fx.backupsTried.size());
        assertEquals(List.of(1, 2, 3, 4, 5), fx.levels);
        assertEquals(4, fx.records.stream().filter(r -> r.equals("a escalated")).count());
    }

    @Test
    public void theVolumeRisesWithEachLevel() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        RingTuning.Settings quiet = RingTuning.settings("aggressive", 0);
        c.start(standardChecked("a"), quiet, 0);
        tickTo(c, 500, 9_500);
        float beforeLevel2 = fx.volumes.get(fx.volumes.size() - 1);
        c.tick(10_000);
        float atLevel2 = fx.volumes.get(fx.volumes.size() - 1);
        assertEquals("level 2 is the ramp times 1.4", RingTuning.volumeAt(quiet, 10_000) * 1.4, atLevel2, 1e-4);
        assertTrue(atLevel2 > beforeLevel2 * 1.3);
    }

    @Test
    public void withoutAWakeCheckInThePlanTheChallengeLevelDoesNotPromptOne() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        tickTo(c, 500, 80_000);
        assertEquals(5, c.level().level);
        assertEquals(0, fx.challenges);
        assertEquals(1, fx.backupsTried.size());
    }

    @Test
    public void aSlowPassGoesStraightToTheTopAsOnTheWeb() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(standardChecked("a"), TUNING, 0);
        c.tick(3_000);
        c.escalateToTop(3_000);
        assertEquals(5, c.level().level);
        assertTrue(fx.vibrating);
        assertEquals(1, fx.backupsTried.size());
        c.escalateToTop(4_000);
        assertEquals("not again", 1, fx.backupsTried.size());
        c.onBackups(Backups.failedAll(EscalationLadder.BACKUP_KINDS, "couldn't reach the server"), 4_500);
        c.dismiss(5_000, passed(1, 90));
        assertEquals(List.of("a dismissed rang 0 ended 5000 checked level 5 backups 3"), fx.queued);
    }

    static Backups.Answer rangTablet() {
        return Backups.fromResponse(List.of("secondaryAlarm", "smartwatch"), 200,
            "{\"data\":{\"outcomes\":["
            + "{\"kind\":\"secondaryAlarm\",\"status\":\"delivered\",\"receipt\":{\"transport\":\"fcm\",\"messageId\":\"projects/p/messages/1\",\"at\":\"2026-10-28T07:01:15Z\"}},"
            + "{\"kind\":\"smartwatch\",\"status\":\"not_configured\",\"reason\":\"no watch app\"}],\"later\":[]}}");
    }

    @Test
    public void theBackupsAreAskedForTheRingingAlarmAndTheirAnswerGoesWithTheReport() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.escalateToTop(1_000);
        assertEquals(List.of("a"), fx.backupsFor);
        c.onBackups(rangTablet(), 2_000);
        assertTrue(fx.records.contains("a backups"));
        c.dismiss(3_000, Verification.none(3_000));
        assertEquals(List.of("a dismissed rang 0 ended 3000 unchecked level 5 backups 2"), fx.queued);
    }

    @Test
    public void aDeviceRungAsABackupIsStoppedWhenThisRingStops() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.escalateToTop(1_000);
        c.onBackups(rangTablet(), 2_000);
        assertTrue("still ringing here: nothing stopped yet", fx.backupStops.isEmpty());
        c.dismiss(3_000, Verification.none(3_000));
        assertEquals(List.of("a"), fx.backupStops);
    }

    @Test
    public void anAnswerAfterTheRingEndedIsRecordedAndItsDeviceStopped() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.escalateToTop(1_000);
        c.dismiss(2_000, Verification.none(2_000));
        assertEquals("the report went without it", List.of("a dismissed rang 0 ended 2000 unchecked level 5"), fx.queued);
        c.onBackups(rangTablet(), 9_000);
        assertTrue(fx.records.contains("a backups"));
        assertEquals("rung after the user was up: stopped at once", List.of("a"), fx.backupStops);
    }

    @Test
    public void nothingIsStoppedWhenNoOtherDeviceWasRung() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.escalateToTop(1_000);
        c.onBackups(Backups.failedAll(List.of("secondaryAlarm"), "couldn't reach the server"), 2_000);
        c.dismiss(3_000, Verification.none(3_000));
        assertTrue(fx.backupStops.isEmpty());
    }

    @Test
    public void theLevelReachedIsWhatTheServerIsTold() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        tickTo(c, 500, 23_000);
        c.dismiss(23_000, Verification.none(23_000));
        assertEquals(List.of("a dismissed rang 0 ended 23000 unchecked level 3"), fx.queued);
    }

    @Test
    public void anEasyWakersPersonalLadderHoldsBackupsBackAndClimbsSlower() throws Exception {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(withLadder("a", "easy", false, false), TUNING, 0);
        tickTo(c, 500, 93_500);
        assertEquals("level 5 is at 94 s for this sleeper", 4, c.level().level);
        tickTo(c, 94_000, 200_000);
        assertEquals(5, c.level().level);
        assertTrue("held back: no backups", fx.backupsTried.isEmpty());
    }

    @Test
    public void anUnmissableAlarmClimbsTheFullLadderWhateverThePersonalPlanHoldsBack() throws Exception {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(withLadder("a", "easy", true, false), TUNING, 0);
        tickTo(c, 500, 74_500);
        assertTrue(fx.backupsTried.isEmpty());
        c.tick(75_000);
        assertEquals("at the standard 75 s, not the personal 94 s", 5, c.level().level);
        assertEquals(List.of(EscalationLadder.BACKUP_KINDS), fx.backupsTried);
    }

    @Test
    public void anUnmissableAlarmJoiningMakesTheFullLadderApply() throws Exception {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(withLadder("easy", "easy", false, false), TUNING, 0);
        tickTo(c, 500, 40_000);
        c.start(withLadder("critical", "easy", true, false), TUNING, 40_000);
        tickTo(c, 40_500, 75_000);
        assertEquals(5, c.level().level);
        assertEquals("the unmissable alarm brings the backups in at 75 s", 1, fx.backupsTried.size());
    }

    @Test
    public void aHardWakersLadderClimbsSooner() throws Exception {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(withLadder("a", "hard", false, false), TUNING, 0);
        c.tick(6_000);
        assertEquals("10 s x 0.6", 2, c.level().level);
        tickTo(c, 6_500, 45_000);
        assertEquals("75 s x 0.6", 5, c.level().level);
        assertEquals(1, fx.backupsTried.size());
    }

    @Test
    public void ticksAfterTheEndDoNothing() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.dismiss(1_000, Verification.none(1_000));
        int volumes = fx.volumes.size();
        c.tick(1_500);
        c.soundFailed(1_600);
        assertEquals(volumes, fx.volumes.size());
        fx.assertNothingHeld();
    }
}
