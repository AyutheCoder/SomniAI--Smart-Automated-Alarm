package app.somniai.alarm.alarms;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The morning report as a notification (prompt 3.4). Once a ring's result has
 * reached the server (its dismiss or missed call was accepted), the phone asks
 * for that ring's report, worded by the server in this phone's time zone, and
 * shows it. Never at ring time: only after the sync. Pure; tested in
 * MorningNoticeTest.
 */
final class MorningNotice {

    private static final Pattern ENDED = Pattern.compile("^/api/alarms/([^/?]+)/(dismiss|missed)$");

    final String alarmId;
    final String title;
    /** One line, for the collapsed notification. */
    final String summary;
    /** Every line of the report, for the expanded one. */
    final String text;

    private MorningNotice(String alarmId, String title, String summary, String text) {
        this.alarmId = alarmId;
        this.title = title;
        this.summary = summary;
        this.text = text;
    }

    /** The alarm whose ring this accepted call ended, or null. */
    static String endedAlarm(String path, int status) {
        if (status < 200 || status >= 300 || path == null) {
            return null;
        }
        Matcher m = ENDED.matcher(path);
        return m.matches() ? m.group(1) : null;
    }

    /** Where to ask for that ring's report. */
    static String reportPath(String alarmId, String timeZone) {
        try {
            return "/api/wake-reports?limit=1&alarmId=" + java.net.URLEncoder.encode(alarmId, "UTF-8")
                + "&tz=" + java.net.URLEncoder.encode(timeZone, "UTF-8");
        }
        catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The notice from the server's answer, or null if it has no report for this alarm. */
    static MorningNotice fromResponse(String alarmId, int status, String body) {
        if (status != 200 || body == null) {
            return null;
        }
        try {
            JSONArray reports = new JSONObject(body).getJSONObject("data").getJSONArray("reports");
            for (int i = 0; i < reports.length(); i++) {
                JSONObject r = reports.getJSONObject(i);
                if (!alarmId.equals(r.optString("alarmId"))) {
                    continue;
                }
                JSONObject lines = r.getJSONObject("lines");
                String stage = lines.getString("stage");
                String text = String.join("\n",
                    stage,
                    lines.getString("verification"),
                    lines.getString("plan"),
                    lines.getString("streak"),
                    lines.getString("profile"));
                return new MorningNotice(alarmId, "Morning report: " + lines.getString("title"), stage, text);
            }
            return null;
        }
        catch (JSONException e) {
            return null;
        }
    }
}
