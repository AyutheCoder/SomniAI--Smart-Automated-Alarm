package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.Collections;
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
 * While ringing it climbs the alarm's escalation ladder ({@link EscalationLadder},
 * from the ring plan cached on the phone): louder at each level's volume
 * factor, continuous vibration from the vibration level, the wake check put in
 * front of the user at the challenge level (if the plan has one), and the
 * backup channels tried once at the backup level. A sequence solved but too
 * slow jumps to the top level, as on the web. A level jumped past isn't played
 * separately: each level includes everything below it.
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
        /** Its ring plan's escalation ladder. */
        final EscalationLadder ladder;

        Alarm(String id, String label, long scheduledFor, WakeCheck.Plan check, EscalationLadder ladder) {
            this.id = id;
            this.label = label;
            this.scheduledFor = scheduledFor;
            this.check = check;
            this.ladder = ladder;
        }
    }

    interface Effects {
        /** Must come first: Android requires it within seconds of the service starting. Returns false if refused. */
        boolean startForeground(Alarm first);
        void showAlarms(Iterable<Alarm> ringing);
        void acquireWakeLock(long timeoutMs);
        void releaseWakeLock();
        /** Raises the alarm stream for this volume factor (RingTuning.streamIndex); never lowers it. */
        void raiseAlarmVolume(double volumeFactor);
        void restoreAlarmVolume();
        /** Returns false if this source can't play here. */
        boolean startSound(Source source);
        void setVolume(float volume);
        void stopSound();
        /** One short buzz, at the start of a ring that doesn't vibrate yet. */
        void pulse();
        void startVibration();
        void stopVibration();
        /** The ladder moved to this level: show it. */
        void showLevel(EscalationLadder.Level level);
        /** The challenge level: put the wake check in front of the user. */
        void promptChallenge();
        /**
         * The backup level: ask the server, in the background, to try each
         * channel. Never waits: the answer comes back through onBackups.
         */
        void requestBackups(Alarm alarm, List<String> kinds);
        /** The ring ended after another device was rung: stop it there too. */
        void stopBackupRing(Alarm alarm);
        void scheduleTick(long delayMs);
        void cancelTicks();
        void closeRingScreen();
        void stopService();
        void record(Alarm alarm, String outcome, long at, String detail);
        /** Queues the ring for the server: fire, and verify, escalate (the level reached) and dismiss if it was stopped. */
        void queueSync(Alarm alarm, long rangAt, String outcome, long endedAt, Verification verification, int level, List<Backups.Outcome> backups);
    }

    private final Effects fx;
    private State state = State.IDLE;
    private final Map<String, Alarm> ringing = new LinkedHashMap<>();
    /** When each alarm in this ring started ringing (the first, or when it joined). */
    private final Map<String, Long> rangAt = new LinkedHashMap<>();
    private RingTuning.Settings settings = RingTuning.DEFAULT;
    private long startedAt;
    private Source source;
    private EscalationLadder.Level level;
    private boolean vibrating;
    /** Whether this ring asked for its backups yet: once only. */
    private boolean backupsRequested;
    /** What the backup channels did, once the server answered; null before. */
    private List<Backups.Outcome> backups;
    /** The alarms of the ring that last ended, for an answer that comes after it. */
    private List<Alarm> ended = Collections.emptyList();
    private boolean endedRangAnotherDevice;

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

    /** The level the ring is at; null when not ringing. */
    EscalationLadder.Level level() {
        return state == State.RINGING ? level : null;
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
     * The ladder this ring climbs: the first alarm's, unless one of the alarms
     * ringing is unmissable, whose full ladder then applies.
     */
    EscalationLadder ladder() {
        EscalationLadder chosen = null;
        for (Alarm a : ringing.values()) {
            if (chosen == null || (a.ladder.critical && !chosen.critical)) {
                chosen = a.ladder;
            }
        }
        return chosen;
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
     * ring carries on (no restart of the ramp or the ladder) and dismissing
     * stops both. An unmissable alarm joining makes the full ladder apply.
     */
    void start(Alarm alarm, RingTuning.Settings tuning, long now) {
        if (state == State.RINGING) {
            if (ringing.put(alarm.id, alarm) == null) {
                rangAt.put(alarm.id, now);
                fx.showAlarms(ringing.values());
                fx.record(alarm, "ringing", now, "joined an alarm already ringing; ladder " + ladder().source);
                climbTo(now);
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
        vibrating = false;
        backups = null;
        backupsRequested = false;
        level = null;
        boolean foreground = fx.startForeground(alarm);
        fx.acquireWakeLock(RingTuning.MAX_RING_MS + 60_000);
        source = null;
        playFrom(Source.ALARM_SOUND);
        enter(ladder().at(0), now);
        fx.setVolume(RingTuning.playerVolume(settings, 0, level.volumeFactor));
        if (!vibrating) {
            if (source == null) {
                // No sound at all: vibration is the only signal left, so it starts now.
                startVibrating();
            }
            else {
                fx.pulse();
            }
        }
        fx.scheduleTick(RingTuning.TICK_MS);
        fx.record(alarm, "ringing", now, "sound " + describe(source) + "; ladder " + ladder().source
            + (foreground ? "" : "; foreground service refused"));
    }

    /** Steps the ramp and the ladder; stops the ring once it has gone unanswered too long. */
    void tick(long now) {
        if (state != State.RINGING) {
            return;
        }
        long elapsed = now - startedAt;
        if (elapsed >= RingTuning.MAX_RING_MS) {
            finish("unanswered", now, "rang " + elapsed / 1000 + " s, reached level " + level.level, null);
            return;
        }
        climbTo(now);
        fx.setVolume(RingTuning.playerVolume(settings, elapsed, level.volumeFactor));
        fx.scheduleTick(RingTuning.TICK_MS);
    }

    /**
     * The wake check was solved but not convincingly (below minConfidence):
     * straight to the top of the ladder, as the web does.
     */
    void escalateToTop(long now) {
        if (state != State.RINGING) {
            return;
        }
        EscalationLadder.Level top = ladder().top();
        if (top.level > level.level) {
            enter(top, now);
            fx.setVolume(RingTuning.playerVolume(settings, now - startedAt, level.volumeFactor));
        }
    }

    private void climbTo(long now) {
        EscalationLadder.Level due = ladder().at(now - startedAt);
        if (due.level > level.level) {
            enter(due, now);
        }
    }

    private void enter(EscalationLadder.Level l, long now) {
        boolean first = level == null;
        level = l;
        fx.raiseAlarmVolume(l.volumeFactor);
        if (l.vibrate) {
            startVibrating();
        }
        fx.showLevel(l);
        if (l.requireVerification && check().required) {
            fx.promptChallenge();
        }
        if (!l.backup.isEmpty() && !backupsRequested) {
            backupsRequested = true;
            fx.requestBackups(ringing.values().iterator().next(), l.backup);
        }
        if (!first) {
            for (Alarm a : ringing.values()) {
                fx.record(a, "escalated", now, "level " + l.level + " (" + l.label + ") after " + (now - startedAt) / 1000 + " s");
            }
        }
    }

    private void startVibrating() {
        if (!vibrating) {
            fx.startVibration();
            vibrating = true;
        }
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
        if (source == null) {
            startVibrating();
        }
        fx.setVolume(RingTuning.playerVolume(settings, now - startedAt, level.volumeFactor));
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
        finish("dismissed", now, "after " + (now - startedAt) / 1000 + " s at level " + level.level + "; " + verification.describe(), verification);
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

    /**
     * The server's answer to requestBackups, on the main thread. During the
     * ring it is recorded and goes with the ring's report; after it, it is
     * recorded, and a device it rang is stopped.
     */
    void onBackups(Backups.Answer answer, long now) {
        StringBuilder said = new StringBuilder();
        for (Backups.Outcome o : answer.outcomes) {
            said.append(said.length() > 0 ? "; " : "").append(o.kind).append(": ").append(o.status)
                .append(o.reason == null || o.reason.isEmpty() ? "" : " (" + o.reason + ")");
        }
        for (Backups.Later l : answer.later) {
            said.append(said.length() > 0 ? "; " : "").append(l.who).append(": later, at ").append(java.time.Instant.ofEpochMilli(l.at));
        }
        if (state == State.RINGING) {
            backups = answer.outcomes;
            for (Alarm a : ringing.values()) {
                fx.record(a, "backups", now, said.toString());
            }
            return;
        }
        for (Alarm a : ended) {
            fx.record(a, "backups", now, said + " (after the ring ended)");
        }
        if (answer.rangAnotherDevice() && !ended.isEmpty() && !endedRangAnotherDevice) {
            fx.stopBackupRing(ended.get(0));
        }
    }

    private void finish(String outcome, long now, String detail, Verification verification) {
        int reached = level.level;
        List<Backups.Outcome> tried = backups == null ? Collections.emptyList() : backups;
        endedRangAnotherDevice = new Backups.Answer(tried, Collections.emptyList()).rangAnotherDevice();
        ended = new ArrayList<>(ringing.values());
        release();
        fx.closeRingScreen();
        for (Alarm a : ringing.values()) {
            fx.record(a, outcome, now, detail);
            fx.queueSync(a, rangAt.get(a.id), outcome, now, verification, reached, tried);
        }
        if (endedRangAnotherDevice) {
            fx.stopBackupRing(ended.get(0));
        }
        ringing.clear();
        rangAt.clear();
        state = State.STOPPED;
        fx.stopService();
    }

    private void release() {
        fx.cancelTicks();
        fx.stopVibration();
        vibrating = false;
        fx.stopSound();
        source = null;
        fx.restoreAlarmVolume();
        fx.releaseWakeLock();
    }
}
