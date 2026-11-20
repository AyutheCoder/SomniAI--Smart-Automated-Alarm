package app.somniai.alarm.alarms;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alarm telemetry, with consent (prompt 5.1): for each wake (every ring of one
 * occurrence of an alarm, snoozes included), the time from each ring starting
 * to the user's first interaction, how many times it was snoozed, the stage of
 * the escalation ladder it reached, and how the wake check went.
 *
 * Nothing is recorded without consent: a ring that starts while consent is off
 * opens no wake, and withdrawing consent drops whatever was open. The server
 * checks the same again (lib/telemetry.ts).
 *
 * Times to first interaction are measured on the monotonic clock
 * (SystemClock.elapsedRealtime), from the ring starting to the touch or key
 * event's own timestamp, so neither a wall-clock change nor the delay in
 * handing the event to the service shifts them. Wall-clock times are kept only
 * to say when it happened.
 *
 * Pure: storage is passed in, and the clock values are arguments. Tested in
 * WakeTelemetryTest.
 */
final class WakeTelemetry {

    interface Store {
        String read();
        void write(String json);
    }

    static final class Consent {
        final boolean granted;
        final String version;
        final long at;

        Consent(boolean granted, String version, long at) {
            this.granted = granted;
            this.version = version;
            this.at = at;
        }
    }

    /** An open wake not heard from for this long (a snooze cancelled with its alarm) is dropped, not sent. */
    static final long STALE_MS = 3 * 60 * 60_000L;

    private final Store store;

    WakeTelemetry(Store store) {
        this.store = store;
    }

    /**
     * The event's time on the monotonic clock. Input events carry their time
     * on the uptime clock (MotionEvent/KeyEvent.getEventTime()); this moves it
     * to elapsedRealtime by how long ago it happened.
     */
    static long elapsedOfEvent(long eventUptime, long nowUptime, long nowElapsed) {
        return nowElapsed - Math.max(0, nowUptime - eventUptime);
    }

    synchronized Consent consent() {
        JSONObject c = state().optJSONObject("consent");
        return c == null ? new Consent(false, null, 0)
            : new Consent(c.optBoolean("granted"), c.isNull("version") ? null : c.optString("version"), c.optLong("at"));
    }

    /** Returns how many open wakes were dropped: all of them, when consent is withdrawn. */
    synchronized int setConsent(boolean granted, String version, long at) {
        JSONObject s = state();
        int dropped = 0;
        put(s, "consent", obj("granted", granted, "version", version == null ? JSONObject.NULL : version, "at", at));
        if (!granted) {
            dropped = s.optJSONObject("open") == null ? 0 : s.optJSONObject("open").length();
            put(s, "open", new JSONObject());
        }
        save(s);
        return dropped;
    }

    /** Drops every open wake (the user deleted their telemetry). Returns how many. */
    synchronized int clear() {
        JSONObject s = state();
        int n = s.optJSONObject("open") == null ? 0 : s.optJSONObject("open").length();
        put(s, "open", new JSONObject());
        save(s);
        return n;
    }

    synchronized int openWakes() {
        JSONObject open = state().optJSONObject("open");
        return open == null ? 0 : open.length();
    }

    /**
     * A ring started. With consent: a new wake, or the next ring of one that
     * was snoozed. Without: nothing at all.
     */
    synchronized void ringStarted(String alarmId, long scheduledFor, long wallAt, long elapsedAt) {
        Consent c = consent();
        if (!c.granted) {
            return;
        }
        JSONObject s = state();
        JSONObject open = open(s);
        dropStale(open, wallAt);
        JSONObject wake = open.optJSONObject(alarmId);
        if (wake != null && !wake.isNull("snoozedUntil")) {
            put(wake, "snoozedUntil", JSONObject.NULL);
        }
        else if (wake != null && inProgress(wake) != null) {
            // Rung again before the last ring ended (Android restarted the service): that ring was interrupted.
            JSONObject last = inProgress(wake);
            put(last, "outcome", "interrupted");
            put(last, "durationMs", Math.max(0, elapsedAt - last.optLong("startElapsed")));
        }
        else {
            wake = obj("alarmId", alarmId, "scheduledFor", scheduledFor, "firstRingAt", wallAt,
                "consentVersion", c.version, "snoozes", 0, "rings", new JSONArray(), "snoozedUntil", JSONObject.NULL);
            put(open, alarmId, wake);
        }
        put(wake, "touchedAt", wallAt);
        wake.optJSONArray("rings").put(obj("at", wallAt, "startElapsed", elapsedAt, "firstInteractionMs", JSONObject.NULL,
            "via", JSONObject.NULL, "outcome", JSONObject.NULL));
        save(s);
    }

    /**
     * The user touched the ring screen, pressed a key, or opened it from the
     * notification. Counts only as the first interaction of each ring in
     * progress, and only if it came after the ring started.
     */
    synchronized void interacted(long elapsedAt, String via) {
        JSONObject s = state();
        JSONObject open = open(s);
        boolean changed = false;
        for (Iterator<String> ids = open.keys(); ids.hasNext(); ) {
            JSONObject ring = inProgress(open.optJSONObject(ids.next()));
            if (ring == null || !ring.isNull("firstInteractionMs")) {
                continue;
            }
            long ms = elapsedAt - ring.optLong("startElapsed");
            if (ms >= 0) {
                put(ring, "firstInteractionMs", ms);
                put(ring, "via", via);
                changed = true;
            }
        }
        if (changed) {
            save(s);
        }
    }

    /**
     * A ring ended. Snoozed: the wake stays open for the next ring. Otherwise
     * the wake is complete and returned, for the server; null when there is
     * no wake (no consent when it started, or withdrawn since).
     *
     * @param outcome "dismissed", "snoozed" or "unanswered"
     * @param stage the reached level's stage (EscalationLadder.Level.stage)
     * @param checkRequired whether the ring plan asked for a wake check
     */
    synchronized JSONObject ringEnded(String alarmId, String outcome, long wallAt, long elapsedAt, int level, String stage,
            Verification v, boolean checkRequired) {
        JSONObject s = state();
        JSONObject open = open(s);
        JSONObject wake = open.optJSONObject(alarmId);
        JSONObject ring = wake == null ? null : inProgress(wake);
        if (ring == null) {
            return null;
        }
        put(ring, "outcome", outcome);
        put(ring, "durationMs", Math.max(0, elapsedAt - ring.optLong("startElapsed")));
        put(ring, "level", level);
        put(ring, "stage", stage);
        put(wake, "touchedAt", wallAt);
        if ("snoozed".equals(outcome)) {
            put(wake, "snoozes", wake.optInt("snoozes") + 1);
            put(wake, "snoozedUntil", wallAt + RingController.SNOOZE_MS);
            save(s);
            return null;
        }
        open.remove(alarmId);
        save(s);
        return record(wake, outcome, wallAt, v, checkRequired);
    }

    /** What is sent: no app, place or content, only the wake's timings and outcomes. */
    private static JSONObject record(JSONObject wake, String outcome, long endedAt, Verification v, boolean checkRequired) {
        JSONArray rings = new JSONArray();
        JSONArray kept = wake.optJSONArray("rings");
        int maxLevel = 0;
        String maxStage = null;
        for (int i = 0; i < kept.length(); i++) {
            JSONObject r = kept.optJSONObject(i);
            rings.put(obj("at", iso(r.optLong("at")),
                "firstInteractionMs", r.isNull("firstInteractionMs") ? JSONObject.NULL : r.optLong("firstInteractionMs"),
                "via", r.isNull("via") ? JSONObject.NULL : r.optString("via"),
                "durationMs", r.optLong("durationMs"),
                "level", r.optInt("level"),
                "stage", r.optString("stage"),
                "outcome", r.optString("outcome")));
            if (r.optInt("level") > maxLevel) {
                maxLevel = r.optInt("level");
                maxStage = r.optString("stage");
            }
        }
        JSONObject first = kept.optJSONObject(0);
        return obj("alarmId", wake.optString("alarmId"),
            "scheduledFor", iso(wake.optLong("scheduledFor")),
            "consentVersion", wake.isNull("consentVersion") ? JSONObject.NULL : wake.optString("consentVersion"),
            "firstRingAt", iso(wake.optLong("firstRingAt")),
            "endedAt", iso(endedAt),
            "outcome", outcome,
            "snoozes", wake.optInt("snoozes"),
            "firstInteractionMs", first == null || first.isNull("firstInteractionMs") ? JSONObject.NULL : first.optLong("firstInteractionMs"),
            "stageReached", obj("level", maxLevel, "stage", maxStage == null ? JSONObject.NULL : maxStage),
            "verification", verification(outcome, v, checkRequired),
            "rings", rings);
    }

    /** "passed" with what the check took; "not_required"; or "not_passed" for a wake the check never let go. */
    static JSONObject verification(String outcome, Verification v, boolean checkRequired) {
        if (!checkRequired) {
            return obj("required", false, "result", "not_required");
        }
        if ("dismissed".equals(outcome) && v != null && v.challenged && v.solved) {
            return obj("required", true, "result", "passed",
                "attempts", v.attempts,
                "steps", Math.max(1, v.steps),
                "timeOnTaskMs", v.responseMs,
                "correctness", v.correctness,
                "methods", new JSONArray(v.methods));
        }
        return obj("required", true, "result", "not_passed");
    }

    private static JSONObject inProgress(JSONObject wake) {
        if (wake == null) {
            return null;
        }
        JSONArray rings = wake.optJSONArray("rings");
        JSONObject last = rings == null || rings.length() == 0 ? null : rings.optJSONObject(rings.length() - 1);
        return last != null && last.isNull("outcome") ? last : null;
    }

    private static void dropStale(JSONObject open, long now) {
        List<String> stale = new ArrayList<>();
        for (Iterator<String> ids = open.keys(); ids.hasNext(); ) {
            String id = ids.next();
            if (now - open.optJSONObject(id).optLong("touchedAt") > STALE_MS) {
                stale.add(id);
            }
        }
        for (String id : stale) {
            open.remove(id);
        }
    }

    private JSONObject state() {
        String raw = store.read();
        try {
            return raw == null || raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
        }
        catch (JSONException e) {
            // Unreadable: start again. Consent then reads as not given, so nothing is recorded until it is.
            return new JSONObject();
        }
    }

    private static JSONObject open(JSONObject s) {
        JSONObject open = s.optJSONObject("open");
        if (open == null) {
            open = new JSONObject();
            put(s, "open", open);
        }
        return open;
    }

    private void save(JSONObject s) {
        store.write(s.toString());
    }

    static String iso(long epochMs) {
        return Instant.ofEpochMilli(epochMs).toString();
    }

    private static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i < kv.length; i += 2) {
            put(o, (String) kv[i], kv[i + 1] == null ? JSONObject.NULL : kv[i + 1]);
        }
        return o;
    }

    private static void put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value);
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
