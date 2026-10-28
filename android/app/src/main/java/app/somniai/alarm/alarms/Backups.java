package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The ladder's last stage: other devices and people that can wake the
 * sleeper (prompt 3.3). The server has the transports (lib/backupServer.ts);
 * the ringing phone asks it in the background and reads the answer here, as
 * lib/backupClient.ts does on the web. Each channel reports exactly one of
 * delivered, failed or not_configured, and the answer is checked, not
 * trusted: a channel the server didn't answer for has failed, and
 * "delivered" without a transport's receipt has failed. People told after
 * the sleeper's delay come back as "later", with the time. Pure; tested in
 * BackupsTest.
 */
final class Backups {

    static final String DELIVERED = "delivered";
    static final String FAILED = "failed";
    static final String NOT_CONFIGURED = "not_configured";

    static final class Outcome {
        final String kind;
        final String status;
        final String reason;

        Outcome(String kind, String status, String reason) {
            this.kind = kind;
            this.status = status;
            this.reason = reason;
        }
    }

    /** Someone the server tells later, if the alarm still isn't answered. */
    static final class Later {
        /** "buddy" or "emergencyContact". */
        final String who;
        final String name;
        final long at;

        Later(String who, String name, long at) {
            this.who = who;
            this.name = name;
            this.at = at;
        }
    }

    static final class Answer {
        final List<Outcome> outcomes;
        final List<Later> later;

        Answer(List<Outcome> outcomes, List<Later> later) {
            this.outcomes = outcomes;
            this.later = later;
        }

        boolean rangAnotherDevice() {
            for (Outcome o : outcomes) {
                if (o.kind.equals("secondaryAlarm") && o.status.equals(DELIVERED)) {
                    return true;
                }
            }
            return false;
        }
    }

    private Backups() {}

    /** The request to POST /api/alarms/{id}/backups. */
    static JSONObject request(List<String> kinds, String fromToken) {
        try {
            JSONObject o = new JSONObject().put("kinds", new JSONArray(kinds));
            if (fromToken != null) {
                o.put("fromToken", fromToken);
            }
            return o;
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * The server's answer, checked. status -1: it couldn't be reached.
     */
    static Answer fromResponse(List<String> kinds, int status, String body) {
        if (status < 200 || status >= 300) {
            return failedAll(kinds, status < 0 ? "couldn't reach the server" : "the server said " + status);
        }
        JSONObject data;
        try {
            data = new JSONObject(body == null ? "" : body).optJSONObject("data");
        }
        catch (JSONException e) {
            data = null;
        }
        if (data == null) {
            return failedAll(kinds, "the server's answer couldn't be read");
        }
        List<Later> later = new ArrayList<>();
        JSONArray l = data.optJSONArray("later");
        for (int i = 0; l != null && i < l.length(); i++) {
            JSONObject o = l.optJSONObject(i);
            String who = o == null ? null : o.optString("who", null);
            long at = o == null ? -1 : parseTime(o.optString("at", ""));
            if (("buddy".equals(who) || "emergencyContact".equals(who)) && at > 0 && o.optString("name", "").length() > 0) {
                later.add(new Later(who, o.optString("name"), at));
            }
        }
        JSONArray given = data.optJSONArray("outcomes");
        List<Outcome> outcomes = new ArrayList<>();
        for (String kind : kinds) {
            if (kind.equals("emergencyContact") && isLater(later, "emergencyContact")) {
                continue;
            }
            JSONObject o = find(given, kind);
            String s = o == null ? null : o.optString("status", null);
            if (DELIVERED.equals(s)) {
                outcomes.add(hasReceipt(o.optJSONObject("receipt"))
                    ? new Outcome(kind, DELIVERED, null)
                    : new Outcome(kind, FAILED, "reported delivered without a receipt"));
            }
            else if (FAILED.equals(s) || NOT_CONFIGURED.equals(s)) {
                outcomes.add(new Outcome(kind, s, o.optString("reason", "")));
            }
            else {
                outcomes.add(new Outcome(kind, FAILED, "the server didn't answer for it"));
            }
        }
        return new Answer(outcomes, later);
    }

    static Answer failedAll(List<String> kinds, String reason) {
        List<Outcome> out = new ArrayList<>();
        for (String kind : kinds) {
            out.add(new Outcome(kind, FAILED, reason));
        }
        return new Answer(out, new ArrayList<>());
    }

    /** "Your buddy Bo and Mum will be told at 7:15 if you haven't answered." Null with nobody. */
    static String laterLine(List<Later> later, java.util.function.LongFunction<String> clock) {
        if (later.isEmpty()) {
            return null;
        }
        List<String> names = new ArrayList<>();
        long first = Long.MAX_VALUE;
        for (Later l : later) {
            names.add(l.who.equals("buddy") ? "your buddy " + l.name : l.name);
            first = Math.min(first, l.at);
        }
        String who = names.size() == 1 ? names.get(0)
            : String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.get(names.size() - 1);
        return Character.toUpperCase(who.charAt(0)) + who.substring(1) + " will be told at " + clock.apply(first) + " if you haven't answered.";
    }

    static String label(String kind) {
        switch (kind) {
            case "secondaryAlarm":
                return "second device";
            case "smartwatch":
                return "smartwatch";
            case "emergencyContact":
                return "emergency contact";
            default:
                return kind;
        }
    }

    /** As the escalate route takes them: [{ kind, status }]. */
    static JSONArray toJson(List<Outcome> outcomes) {
        JSONArray a = new JSONArray();
        for (Outcome o : outcomes) {
            try {
                a.put(new JSONObject().put("kind", o.kind).put("status", o.status));
            }
            catch (JSONException e) {
                throw new IllegalStateException(e);
            }
        }
        return a;
    }

    private static boolean isLater(List<Later> later, String who) {
        for (Later l : later) {
            if (l.who.equals(who)) {
                return true;
            }
        }
        return false;
    }

    private static JSONObject find(JSONArray a, String kind) {
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && kind.equals(o.optString("kind"))) {
                return o;
            }
        }
        return null;
    }

    private static boolean hasReceipt(JSONObject r) {
        return r != null && r.optString("transport", "").trim().length() > 0
            && r.optString("messageId", "").trim().length() > 0
            && parseTime(r.optString("at", "")) > 0;
    }

    private static long parseTime(String iso) {
        try {
            return java.time.Instant.parse(iso).toEpochMilli();
        }
        catch (java.time.format.DateTimeParseException e) {
            return -1;
        }
    }
}
