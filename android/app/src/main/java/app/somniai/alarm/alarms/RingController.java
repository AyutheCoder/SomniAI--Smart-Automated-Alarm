package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
        /** Its ring plan's wake check. */
        final WakeCheck.Plan check;

        Alarm(String id, String label, long scheduledFor, WakeCheck.Plan check) {
            this.id = id;
            this.label = label;
            this.scheduledFor = scheduledFor;
            this.check = check;
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
        /** Queues the ring for the server (fire, and verify and dismiss if it was stopped). */
        void queueSync(Alarm alarm, long rangAt, String outcome, long endedAt, Verification verification);
    }

    private final Effects fx;
    private State state = State.IDLE;
    private final Map<String, Alarm> ringing = new LinkedHashMap<>();
    /** When each alarm in this ring started ringing (the first, or when it joined). */
    private final Map<String, Long> rangAt = new LinkedHashMap<>();
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

    /** The wake check that stops this ring: the strictest of the ringing alarms' plans. */
    WakeCheck.Plan check() {
        List<WakeCheck.Plan> plans = new ArrayList<>();
        for (Alarm a : ringing.values()) {
            plans.add(a.check);
        }
        return WakeCheck.Plan.strictest(plans);
    }

    /**
     * Whether this stops a ring with this check: always if no check is
     * required, otherwise only a sequence at least as long as the plan's,
     * every challenge solved, scoring at least its minConfidence. The ring
     * screen enforces the same; this is the service refusing anything else.
     */
    static boolean passes(WakeCheck.Plan check, Verification v) {
        if (!check.required) {
            return true;
        }
        return v != null && v.challenged && v.solved && v.correctness >= 1
            && v.methods.size() >= check.count
            && WakeConfidence.meetsThreshold(v.score, check.minConfidence);
    }

    /**
     * An alarm went off. If one is already ringing this one joins it: the
     * ring carries on (no restart of the ramp) and dismissing stops both.
     */
    void start(Alarm alarm, RingTuning.Settings tuning, long now) {
        if (state == State.RINGING) {
            if (ringing.put(alarm.id, alarm) == null) {
                rangAt.put(alarm.id, now);
                fx.showAlarms(ringing.values());
                fx.record(alarm, "ringing", now, "joined an alarm already ringing");
            }
            return;
        }
        state = State.RINGING;
        ringing.clear();
        rangAt.clear();
        ringing.put(alarm.id, alarm);
        rangAt.put(alarm.id, now);
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
            finish("unanswered", now, "rang " + elapsed / 1000 + " s", null);
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

    /**
     * The user stopped it. Refused, and recorded as refused, unless the
     * verification {@link #passes} the ring's check. Returns false if nothing
     * was ringing or it was refused.
     */
    boolean dismiss(long now, Verification verification) {
        if (state != State.RINGING) {
            return false;
        }
        WakeCheck.Plan check = check();
        if (!passes(check, verification)) {
            for (Alarm a : ringing.values()) {
                fx.record(a, "dismiss_refused", now, "needs a passed wake check (min " + check.minConfidence + "); got "
                    + (verification == null ? "none" : verification.describe()));
            }
            return false;
        }
        finish("dismissed", now, "after " + (now - startedAt) / 1000 + " s; " + verification.describe(), verification);
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

    private void finish(String outcome, long now, String detail, Verification verification) {
        release();
        fx.closeRingScreen();
        for (Alarm a : ringing.values()) {
            fx.record(a, outcome, now, detail);
            fx.queueSync(a, rangAt.get(a.id), outcome, now, verification);
        }
        ringing.clear();
        rangAt.clear();
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
