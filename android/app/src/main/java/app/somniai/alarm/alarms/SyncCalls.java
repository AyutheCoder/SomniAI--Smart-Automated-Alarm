package app.somniai.alarm.alarms;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The server calls that record one native ring, in the order they must
 * arrive: the same calls as lib/ringFlow.ts syncCalls (fire, verify, escalate, dismiss),
 * each with "at", when it happened on the phone, since they may be sent hours
 * later. Pure; tested in SyncCallsTest.
 */
final class SyncCalls {

    static final class Call {
        final String alarmId;
        final String path;
        final JSONObject body;

        Call(String alarmId, String path, JSONObject body) {
            this.alarmId = alarmId;
            this.path = path;
            this.body = body;
        }
    }

    private SyncCalls() {}

    /**
     * @param outcome "dismissed" or "unanswered"
     * @param verification how it was stopped; null for unanswered
     * @param level the escalation level the ring had reached when it ended
     * @param backups what each backup channel did, if the ladder got that far
     */
    static List<Call> forRing(String alarmId, long rangAt, String outcome, long endedAt, Verification verification,
            int level, List<Backups.Outcome> backups) {
        String base = "/api/alarms/" + alarmId;
        List<Call> calls = new ArrayList<>();
        calls.add(new Call(alarmId, base + "/fire", body("at", iso(rangAt))));
        if (!"dismissed".equals(outcome) || verification == null) {
            // Rang and nobody stopped it: the server keeps it as ringing, which is the truth.
            return calls;
        }
        if (verification.challenged) {
            JSONObject v = body("at", iso(verification.at));
            put(v, "methods", new JSONArray(verification.methods));
            put(v, "responseMs", verification.responseMs);
            put(v, "steps", Math.max(1, verification.steps));
            put(v, "attempts", verification.attempts);
            put(v, "solved", verification.solved);
            put(v, "correctness", verification.correctness);
            calls.add(new Call(alarmId, base + "/verify", v));
        }
        // The level this wake took, which the server learns the personal ladder
        // from, and what the backups did (as lib/ringFlow.ts since prompt 2.6).
        JSONObject e = body("at", iso(endedAt));
        put(e, "level", level);
        put(e, "backups", Backups.toJson(backups));
        calls.add(new Call(alarmId, base + "/escalate", e));
        JSONObject d = body("at", iso(endedAt));
        put(d, "responseMs", Math.max(0, endedAt - rangAt));
        calls.add(new Call(alarmId, base + "/dismiss", d));
        return calls;
    }

    static String iso(long epochMs) {
        return Instant.ofEpochMilli(epochMs).toString();
    }

    private static JSONObject body(String key, Object value) {
        JSONObject o = new JSONObject();
        put(o, key, value);
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
