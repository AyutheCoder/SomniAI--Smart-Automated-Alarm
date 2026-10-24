package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The ladder's last stage: other people and devices that can wake the
 * sleeper. Each channel reports exactly one outcome, as lib/backupAdapters.ts
 * does; "delivered" would need a transport's receipt. No channel has a
 * transport on the phone yet (prompt 3.3 adds real ones), so each one reports
 * "not_configured" and sends nothing. Pure; tested in BackupsTest.
 */
final class Backups {

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

    private Backups() {}

    static List<Outcome> tryAll(List<String> kinds) {
        List<Outcome> out = new ArrayList<>();
        for (String kind : kinds) {
            out.add(new Outcome(kind, "not_configured", "no " + label(kind) + " is set up on this phone yet"));
        }
        return out;
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
}
