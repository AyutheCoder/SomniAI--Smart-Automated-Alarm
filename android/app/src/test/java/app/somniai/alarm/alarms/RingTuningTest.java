package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RingTuningTest {

    @Test
    public void theRingPlanSetsRampAndLoudness() {
        RingTuning.Settings gentle = RingTuning.fromPlan("{\"version\":1,\"sound\":{\"intensity\":40,\"strategy\":\"gentle\"}}");
        assertEquals("gentle", gentle.strategy);
        assertEquals(60_000, gentle.rampMs);
        assertEquals(0.3 + 0.7 * 0.4, gentle.target, 1e-6);
        assertEquals(10_000, RingTuning.fromPlan("{\"sound\":{\"intensity\":100,\"strategy\":\"aggressive\"}}").rampMs);
        assertEquals(1.0, RingTuning.fromPlan("{\"sound\":{\"intensity\":100,\"strategy\":\"aggressive\"}}").target, 1e-6);
    }

    @Test
    public void aMissingOrUnreadablePlanStillRings() {
        for (String plan : new String[] { null, "", "not json", "{}", "{\"sound\":\"loud\"}", "{\"sound\":{\"strategy\":\"unknown\"}}" }) {
            RingTuning.Settings s = RingTuning.fromPlan(plan);
            assertEquals(plan, "adaptive", s.strategy);
            assertTrue(plan, s.target >= 0.3f);
        }
    }

    @Test
    public void intensityZeroIsStillAudibleAndOutOfRangeIsClamped() {
        assertEquals(0.3, RingTuning.settings("adaptive", 0).target, 1e-6);
        assertEquals(0.3, RingTuning.settings("adaptive", -50).target, 1e-6);
        assertEquals(1.0, RingTuning.settings("adaptive", 250).target, 1e-6);
    }

    @Test
    public void theRampStartsThirtyDecibelsDownAndEndsAtTheTarget() {
        RingTuning.Settings s = RingTuning.settings("adaptive", 100);
        assertEquals(Math.pow(10, -30 / 20.0), RingTuning.volumeAt(s, 0), 1e-6);
        assertEquals(Math.pow(10, -15 / 20.0), RingTuning.volumeAt(s, s.rampMs / 2), 1e-6);
        assertEquals(1.0, RingTuning.volumeAt(s, s.rampMs), 1e-6);
        assertEquals("holds after the ramp", 1.0, RingTuning.volumeAt(s, s.rampMs * 10), 1e-6);
        assertEquals("before the start is the start", RingTuning.volumeAt(s, 0), RingTuning.volumeAt(s, -500), 1e-9);
    }

    @Test
    public void eachLevelsVolumeFactorRaisesTheStreamTowardsFull() {
        // Typical alarm stream 1..7: floor 40 % at factor 1, full at the top level's 1.8.
        assertEquals(3, RingTuning.streamIndex(1, 1, 7, 1.0));
        assertEquals("1.4: 70 %", 5, RingTuning.streamIndex(1, 1, 7, 1.4));
        assertEquals(6, RingTuning.streamIndex(1, 1, 7, 1.6));
        assertEquals("1.8: all of it", 7, RingTuning.streamIndex(1, 1, 7, 1.8));
        assertEquals("never lowered", 7, RingTuning.streamIndex(7, 1, 7, 1.0));
        assertEquals("beyond 1.8 is still full", 15, RingTuning.streamIndex(0, 0, 15, 3.0));
    }

    @Test
    public void thePlayerVolumeIsTheRampTimesTheFactorAndNeverPastFull() {
        RingTuning.Settings s = RingTuning.settings("adaptive", 0);
        assertEquals(0.3 * 1.4, RingTuning.playerVolume(s, s.rampMs, 1.4), 1e-6);
        assertEquals(1.0, RingTuning.playerVolume(RingTuning.settings("adaptive", 100), s.rampMs, 1.8), 0);
    }

    @Test
    public void theAlarmStreamIsRaisedToItsFloorOnly() {
        // Typical alarm stream: 1..7.
        assertEquals("turned right down: raised", 3, RingTuning.streamIndex(1, 1, 7));
        assertEquals("at the floor: unchanged", 3, RingTuning.streamIndex(3, 1, 7));
        assertEquals("loud: never lowered", 7, RingTuning.streamIndex(7, 1, 7));
        assertEquals("a min above the floor wins", 5, RingTuning.streamIndex(0, 5, 7));
        assertEquals(6, RingTuning.streamIndex(0, 0, 15));
    }
}
