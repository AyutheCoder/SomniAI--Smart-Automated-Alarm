package app.somniai.alarm.alarms;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * How an alarm sounds: the volume ramp, how long it may ring, and the alarm
 * stream's floor. Pure, tested in RingTuningTest.
 */
final class RingTuning {

    /** An alarm nobody answers stops after this, and is recorded as unanswered. */
    static final long MAX_RING_MS = 20 * 60_000L;
    /** How often the ramp steps the volume. */
    static final long TICK_MS = 500;
    /** The ramp starts this far below its target, in decibels. */
    static final double RAMP_START_DB = -30;
    /** The alarm stream is raised to at least this share of its range while ringing. */
    static final double STREAM_FLOOR = 0.4;

    private RingTuning() {}

    /** Ramp length and loudness, from the alarm's ring plan (lib/ringPlan.ts: sound.strategy, sound.intensity). */
    static final class Settings {
        final String strategy;
        final long rampMs;
        /** Player volume the ramp ends at, 0 to 1, relative to the alarm stream. */
        final float target;

        Settings(String strategy, long rampMs, float target) {
            this.strategy = strategy;
            this.rampMs = rampMs;
            this.target = target;
        }
    }

    static final Settings DEFAULT = settings("adaptive", 60);

    /**
     * A missing or unreadable plan gets the defaults: an alarm rings whatever
     * its plan says, so the plan can only shape how.
     */
    static Settings fromPlan(String ringPlanJson) {
        if (ringPlanJson == null) {
            return DEFAULT;
        }
        try {
            JSONObject sound = new JSONObject(ringPlanJson).optJSONObject("sound");
            if (sound == null) {
                return DEFAULT;
            }
            double intensity = sound.optDouble("intensity", 60);
            return settings(sound.optString("strategy", "adaptive"), Double.isNaN(intensity) ? 60 : intensity);
        }
        catch (JSONException e) {
            return DEFAULT;
        }
    }

    static Settings settings(String strategy, double intensity) {
        long rampMs;
        switch (strategy) {
            case "gentle":
                rampMs = 60_000;
                break;
            case "aggressive":
                rampMs = 10_000;
                break;
            default:
                strategy = "adaptive";
                rampMs = 30_000;
        }
        double clamped = Math.max(0, Math.min(100, intensity));
        // Intensity 0 is still audible: it chooses how loud, never whether.
        return new Settings(strategy, rampMs, (float) (0.3 + 0.7 * clamped / 100));
    }

    /** Player volume after {@code elapsedMs}: rises evenly in decibels to the target, then holds. */
    static float volumeAt(Settings s, long elapsedMs) {
        double p = Math.max(0, Math.min(1, (double) elapsedMs / s.rampMs));
        return (float) (s.target * Math.pow(10, RAMP_START_DB * (1 - p) / 20));
    }

    /**
     * The alarm stream index to ring at: the current one, or the floor if it
     * is below it. Silent mode and the ringer volume don't touch the alarm
     * stream, but an alarm volume turned right down would make a ringing
     * alarm inaudible.
     */
    static int streamIndex(int current, int min, int max) {
        return streamIndex(current, min, max, 1);
    }

    /**
     * The alarm stream index at an escalation level's volume factor: the floor
     * at factor 1, rising to the whole range at the top level's 1.8. Never
     * below what the user set.
     */
    static int streamIndex(int current, int min, int max, double volumeFactor) {
        double share = STREAM_FLOOR + (1 - STREAM_FLOOR) * Math.max(0, Math.min(1, (volumeFactor - 1) / 0.8));
        int floor = Math.max(min, (int) Math.ceil(max * share - 1e-9));
        return Math.max(current, floor);
    }

    /** Player volume at a level's volume factor: the ramp, made louder, never past full. */
    static float playerVolume(Settings s, long elapsedMs, double volumeFactor) {
        return (float) Math.min(1, volumeAt(s, elapsedMs) * volumeFactor);
    }
}
