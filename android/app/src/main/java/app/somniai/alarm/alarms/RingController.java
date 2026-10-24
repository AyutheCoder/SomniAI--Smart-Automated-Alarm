package app.somniai.alarm.alarms;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The life of a ringing alarm, as a state machine that tells the Android side
 * what to do through {@link Effects}. Pure, so every path is tested on the JVM
 * (RingControllerTest); RingService implements the effects.
 *
 * <pre>
 * IDLE --start--> RINGING --dismiss / timeout / destroyed--> STOPPED --start--> RINGING
 * </pre>
 *
 * Every way out of RINGING releases everything it took: sound, vibration,
 * wake lock, the raised alarm volume, the foreground notification. Each alarm
 * that rang gets one outcome in the log: dismissed, unanswered or interrupted.
 */
final class RingController {

    enum State { IDLE, RINGING, STOPPED }

    /** Where the sound comes from, tried in this order until one plays. */
    enum Source {
        /** The phone's alarm sound, as chosen in its clock settings. */
        ALARM_SOUND,
        /** The phone's ringtone, if there is no alarm sound or it won't play. */
        RINGTONE,
        /** A tone made in code: needs no file, so it plays even before the first unlock. */
        TONE,
    }

    /** One alarm in this ring. */
    static final class Alarm {
        final String id;
        final String label;
        final long scheduledFor;

        Alarm(String id, String label, long scheduledFor) {
            this.id = id;
            this.label = label;
            this.scheduledFor = scheduledFor;
        }
    }

    interface Effects {
        /** Must come first: Android requires it within seconds of the service starting. Returns false if refused. */
        boolean startForeground(Alarm first);
        void showAlarms(Iterable<Alarm> ringing);
        void acquireWakeLock(long timeoutMs);
        void releaseWakeLock();
        /** Raises the alarm stream to its floor if below it. */
        void raiseAlarmVolume();
        void restoreAlarmVolume();
        /** Returns false if this source can't play here. */
        boolean startSound(Source source);
        void setVolume(float volume);
        void stopSound();
        void startVibration();
        void stopVibration();
        void scheduleTick(long delayMs);
        void cancelTicks();
        void closeRingScreen();
        void stopService();
        void record(Alarm alarm, String outcome, long at, String detail);
    }

    private final Effects fx;
    private State state = State.IDLE;
    private final Map<String, Alarm> ringing = new LinkedHashMap<>();
    private RingTuning.Settings settings = RingTuning.DEFAULT;
    private long startedAt;
    private Source source;

    RingController(Effects fx) {
        this.fx = fx;
    }

    State state() {
        return state;
    }

    Source source() {
        return source;
    }

    Iterable<Alarm> ringing() {
        return ringing.values();
    }

    /**
     * An alarm went off. If one is already ringing this one joins it: the
     * ring carries on (no restart of the ramp) and dismissing stops both.
     */
    void start(Alarm alarm, RingTuning.Settings tuning, long now) {
        if (state == State.RINGING) {
            if (ringing.put(alarm.id, alarm) == null) {
                fx.showAlarms(ringing.values());
                fx.record(alarm, "ringing", now, "joined an alarm already ringing");
            }
            return;
        }
        state = State.RINGING;
        ringing.clear();
        ringing.put(alarm.id, alarm);
        settings = tuning;
        startedAt = now;
        boolean foreground = fx.startForeground(alarm);
        fx.acquireWakeLock(RingTuning.MAX_RING_MS + 60_000);
        fx.raiseAlarmVolume();
        source = null;
        playFrom(Source.ALARM_SOUND);
        fx.setVolume(RingTuning.volumeAt(settings, 0));
        fx.startVibration();
        fx.scheduleTick(RingTuning.TICK_MS);
        fx.record(alarm, "ringing", now, "sound " + describe(source) + (foreground ? "" : "; foreground service refused"));
    }

    /** Steps the ramp; stops the ring once it has gone unanswered too long. */
    void tick(long now) {
        if (state != State.RINGING) {
            return;
        }
        long elapsed = now - startedAt;
        if (elapsed >= RingTuning.MAX_RING_MS) {
            finish("unanswered", now, "rang " + elapsed / 1000 + " s");
            return;
        }
        fx.setVolume(RingTuning.volumeAt(settings, elapsed));
        fx.scheduleTick(RingTuning.TICK_MS);
    }

    /** The sound stopped with an error while ringing: move on to the next source. */
    void soundFailed(long now) {
        if (state != State.RINGING || source == null) {
            return;
        }
        fx.stopSound();
        Source failed = source;
        Source next = failed.ordinal() + 1 < Source.values().length ? Source.values()[failed.ordinal() + 1] : null;
        source = null;
        if (next != null) {
            playFrom(next);
        }
        fx.setVolume(RingTuning.volumeAt(settings, now - startedAt));
        Alarm first = ringing.values().iterator().next();
        fx.record(first, "sound_failed", now, failed + " stopped; now " + describe(source));
    }

    private static String describe(Source s) {
        return s == null ? "NONE (no source would play; vibration only)" : s.name();
    }

    /** The user stopped it. Returns false if nothing was ringing. */
    boolean dismiss(long now) {
        if (state != State.RINGING) {
            return false;
        }
        finish("dismissed", now, "after " + (now - startedAt) / 1000 + " s");
        return true;
    }

    /** Android is destroying the service while it rings (not by dismissal). */
    void destroyed(long now) {
        if (state != State.RINGING) {
            return;
        }
        release();
        for (Alarm a : ringing.values()) {
            fx.record(a, "interrupted", now, "service destroyed while ringing");
        }
        ringing.clear();
        state = State.STOPPED;
    }

    private void playFrom(Source first) {
        for (int i = first.ordinal(); i < Source.values().length; i++) {
            if (fx.startSound(Source.values()[i])) {
                source = Source.values()[i];
                return;
            }
        }
    }

    private void finish(String outcome, long now, String detail) {
        release();
        fx.closeRingScreen();
        for (Alarm a : ringing.values()) {
            fx.record(a, outcome, now, detail);
        }
        ringing.clear();
        state = State.STOPPED;
        fx.stopService();
    }

    private void release() {
        fx.cancelTicks();
        fx.stopVibration();
        fx.stopSound();
        source = null;
        fx.restoreAlarmVolume();
        fx.releaseWakeLock();
    }
}
