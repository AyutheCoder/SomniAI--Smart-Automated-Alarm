package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * How a ring was stopped: with or without a wake check, and what the check
 * showed. Sent to the server as the raw signals; the server scores them itself.
 */
final class Verification {

    /** Whether a wake check was asked for at all. */
    final boolean challenged;
    final boolean solved;
    final double correctness;
    /** Time on task across the sequence, which is what the score is based on. */
    final long responseMs;
    final int attempts;
    final List<String> methods;
    /** The phone's own score. Not sent: the server never takes a client's score. */
    final int score;
    /** When the check was passed (or Stop pressed, if there was none). */
    final long at;

    Verification(boolean challenged, boolean solved, double correctness, long responseMs, int attempts, List<String> methods, int score, long at) {
        this.challenged = challenged;
        this.solved = solved;
        this.correctness = correctness;
        this.responseMs = responseMs;
        this.attempts = attempts;
        this.methods = methods;
        this.score = score;
        this.at = at;
    }

    /** Stopped with no check, because the ring plan didn't ask for one. */
    static Verification none(long at) {
        return new Verification(false, false, 0, 0, 0, new ArrayList<>(), -1, at);
    }

    JSONObject toJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("challenged", challenged);
            o.put("solved", solved);
            o.put("correctness", correctness);
            o.put("responseMs", responseMs);
            o.put("attempts", attempts);
            o.put("methods", new JSONArray(methods));
            o.put("score", score);
            o.put("at", at);
            return o;
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    static Verification fromJson(String json) {
        try {
            JSONObject o = new JSONObject(json);
            List<String> methods = new ArrayList<>();
            JSONArray m = o.getJSONArray("methods");
            for (int i = 0; i < m.length(); i++) {
                methods.add(m.getString(i));
            }
            return new Verification(o.getBoolean("challenged"), o.getBoolean("solved"), o.getDouble("correctness"),
                o.getLong("responseMs"), o.getInt("attempts"), methods, o.getInt("score"), o.getLong("at"));
        }
        catch (JSONException e) {
            throw new IllegalArgumentException("unreadable verification: " + e.getMessage());
        }
    }

    String describe() {
        return challenged ? "wake check passed, score " + score + ", " + attempts + " wrong answer(s)" : "no wake check in the ring plan";
    }
}
