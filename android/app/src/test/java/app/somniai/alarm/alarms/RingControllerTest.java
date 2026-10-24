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
        @Override public void raiseAlarmVolume() { calls.add("raiseAlarmVolume"); raised = true; }
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

        void assertNothingHeld() {
            assertFalse("wake lock", wakeLock);
            assertFalse("alarm volume left raised", raised);
            assertFalse("sound", sound);
            assertFalse("vibration", vibrating);
            assertFalse("tick", tickPending);
        }
    }

    static RingController.Alarm alarm(String id) {
        return new RingController.Alarm(id, "Gym", 1_000);
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
        assertTrue(fx.vibrating);
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
        assertTrue(c.dismiss(42_000));
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
        assertFalse("nothing ringing yet", c.dismiss(0));
        assertTrue(fx.records.isEmpty());
        c.start(alarm("a"), TUNING, 0);
        assertTrue(c.dismiss(1_000));
        assertFalse(c.dismiss(2_000));
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
        assertEquals(List.of("a ringing", "a unanswered"), fx.records);
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
        c.dismiss(9_000);
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
        c.dismiss(1_000);
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
        c.dismiss(1_000);
        fx.assertNothingHeld();
    }

    @Test
    public void refusedForegroundStillRings() {
        Fake fx = new Fake();
        fx.foregroundAllowed = false;
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        assertTrue(fx.sound);
        assertTrue(fx.vibrating);
        c.dismiss(1_000);
        fx.assertNothingHeld();
    }

    @Test
    public void ringsAgainAfterAnEarlierRingEnded() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.dismiss(1_000);
        c.start(alarm("b"), TUNING, 60_000);
        assertEquals(State.RINGING, c.state());
        assertTrue(fx.sound);
        c.dismiss(61_000);
        assertEquals(List.of("a ringing", "a dismissed", "b ringing", "b dismissed"), fx.records);
        fx.assertNothingHeld();
    }

    @Test
    public void ticksAfterTheEndDoNothing() {
        Fake fx = new Fake();
        RingController c = new RingController(fx);
        c.start(alarm("a"), TUNING, 0);
        c.dismiss(1_000);
        int volumes = fx.volumes.size();
        c.tick(1_500);
        c.soundFailed(1_600);
        assertEquals(volumes, fx.volumes.size());
        fx.assertNothingHeld();
    }
}
