package app.somniai.alarm.alarms;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.EnumSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alarms to and from JSON: what the web app sends, and what is stored on the
 * phone. Anything malformed is refused with a reason, never half-saved.
 *
 * Days use the web app's numbering (lib/recurrence.ts, JavaScript's getDay):
 * 0 is Sunday, 6 is Saturday.
 */
public final class AlarmCodec {

    static final int MAX_ID = 100;
    static final int MAX_LABEL = 200;

    private AlarmCodec() {}

    /** An alarm from the web app. Throws IllegalArgumentException saying what is wrong. */
    public static AlarmSpec specFromJson(JSONObject o) {
        String id = o.optString("id", "").trim();
        if (id.isEmpty() || id.length() > MAX_ID) {
            throw new IllegalArgumentException("id must be 1 to " + MAX_ID + " characters");
        }
        String label = o.optString("label", "");
        if (label.length() > MAX_LABEL) {
            throw new IllegalArgumentException("label must be at most " + MAX_LABEL + " characters");
        }
        int hour = intIn(o, "hour", 0, 23);
        int minute = intIn(o, "minute", 0, 59);

        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        JSONArray rawDays = o.optJSONArray("days");
        if (rawDays != null) {
            for (int i = 0; i < rawDays.length(); i++) {
                Object d = rawDays.opt(i);
                if (!(d instanceof Integer) || (Integer) d < 0 || (Integer) d > 6) {
                    throw new IllegalArgumentException("days must be whole numbers from 0 (Sunday) to 6 (Saturday)");
                }
                days.add(fromWebDay((Integer) d));
            }
        }
        LocalDate date = null;
        if (!o.isNull("date")) {
            try {
                date = LocalDate.parse(o.getString("date"));
            }
            catch (JSONException | DateTimeParseException e) {
                throw new IllegalArgumentException("date must be YYYY-MM-DD");
            }
        }
        if (date == null && days.isEmpty()) {
            throw new IllegalArgumentException("an alarm needs either a date (rings once) or days (repeats)");
        }
        if (date != null && !days.isEmpty()) {
            throw new IllegalArgumentException("an alarm has a date or days, not both");
        }
        boolean enabled = o.optBoolean("enabled", true);
        JSONObject ringPlan = o.optJSONObject("ringPlan");
        return new AlarmSpec(id, label, hour, minute, days, date, enabled, ringPlan == null ? null : ringPlan.toString());
    }

    public static JSONObject specToJson(AlarmSpec a) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", a.id);
            o.put("label", a.label);
            o.put("hour", a.hour);
            o.put("minute", a.minute);
            JSONArray days = new JSONArray();
            for (DayOfWeek d : a.days) {
                days.put(toWebDay(d));
            }
            o.put("days", days);
            o.put("date", a.date == null ? JSONObject.NULL : a.date.toString());
            o.put("enabled", a.enabled);
            o.put("ringPlan", a.ringPlanJson == null ? JSONObject.NULL : new JSONObject(a.ringPlanJson));
            return o;
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static JSONObject recordToJson(AlarmRecord r) {
        try {
            JSONObject o = new JSONObject();
            o.put("alarm", specToJson(r.spec));
            o.put("status", r.status.name().toLowerCase());
            o.put("triggerAt", r.triggerAt == null ? JSONObject.NULL : r.triggerAt);
            o.put("lastFiredAt", r.lastFiredAt == null ? JSONObject.NULL : r.lastFiredAt);
            return o;
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static AlarmRecord recordFromJson(JSONObject o) {
        try {
            AlarmSpec spec = specFromJson(o.getJSONObject("alarm"));
            AlarmRecord.Status status = AlarmRecord.Status.valueOf(o.getString("status").toUpperCase());
            Long triggerAt = o.isNull("triggerAt") ? null : o.getLong("triggerAt");
            Long lastFiredAt = o.isNull("lastFiredAt") ? null : o.getLong("lastFiredAt");
            return new AlarmRecord(spec, status, triggerAt, lastFiredAt);
        }
        catch (JSONException e) {
            throw new IllegalArgumentException("stored alarm is unreadable: " + e.getMessage());
        }
    }

    static DayOfWeek fromWebDay(int day) {
        return DayOfWeek.of(day == 0 ? 7 : day);
    }

    static int toWebDay(DayOfWeek day) {
        return day.getValue() % 7;
    }

    private static int intIn(JSONObject o, String key, int min, int max) {
        Object v = o.opt(key);
        if (!(v instanceof Integer) || (Integer) v < min || (Integer) v > max) {
            throw new IllegalArgumentException(key + " must be a whole number from " + min + " to " + max);
        }
        return (Integer) v;
    }
}
