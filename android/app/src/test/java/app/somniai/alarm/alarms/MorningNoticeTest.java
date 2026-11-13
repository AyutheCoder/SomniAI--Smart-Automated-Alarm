package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class MorningNoticeTest {

    private static final String ID = "6af760243b264d68ff43589e";

    private static String answer(String alarmId, String stage, String streak) throws Exception {
        JSONObject lines = new JSONObject()
            .put("title", "Work, 07:00")
            .put("stage", stage)
            .put("verification", "Wake check passed in 33 s (3 answers).")
            .put("plan", "No plan was set for last night.")
            .put("streak", streak)
            .put("profile", "Escalation profile: learning, 1 of the 3 alarms it needs before it changes your ladder.");
        JSONObject report = new JSONObject().put("alarmId", alarmId).put("kind", "gentle").put("lines", lines);
        return new JSONObject().put("ok", true)
            .put("data", new JSONObject().put("reports", new JSONArray().put(report)).put("tz", "Asia/Kolkata"))
            .toString();
    }

    @Test
    public void onlyAnAcceptedDismissOrMissedEndsARing() {
        assertEquals(ID, MorningNotice.endedAlarm("/api/alarms/" + ID + "/dismiss", 200));
        assertEquals(ID, MorningNotice.endedAlarm("/api/alarms/" + ID + "/missed", 201));
        assertNull(MorningNotice.endedAlarm("/api/alarms/" + ID + "/dismiss", 401));
        assertNull(MorningNotice.endedAlarm("/api/alarms/" + ID + "/dismiss", -1));
        assertNull(MorningNotice.endedAlarm("/api/alarms/" + ID + "/fire", 200));
        assertNull(MorningNotice.endedAlarm("/api/alarms/" + ID + "/escalate", 200));
        assertNull(MorningNotice.endedAlarm(null, 200));
    }

    @Test
    public void asksForThatRingsReportInThisPhonesZone() {
        assertEquals("/api/wake-reports?limit=1&alarmId=" + ID + "&tz=Asia%2FKolkata", MorningNotice.reportPath(ID, "Asia/Kolkata"));
    }

    @Test
    public void showsTheServersLinesAsTheyAre() throws Exception {
        MorningNotice n = MorningNotice.fromResponse(ID, 200,
            answer(ID, "Gentle wake: you were up at level 1 of 5, Normal alarm.", "Streak: 4 alarms answered in a row."));
        assertEquals("Morning report: Work, 07:00", n.title);
        assertEquals("Gentle wake: you were up at level 1 of 5, Normal alarm.", n.summary);
        assertEquals("Gentle wake: you were up at level 1 of 5, Normal alarm.\n"
            + "Wake check passed in 33 s (3 answers).\n"
            + "No plan was set for last night.\n"
            + "Streak: 4 alarms answered in a row.\n"
            + "Escalation profile: learning, 1 of the 3 alarms it needs before it changes your ladder.", n.text);
    }

    @Test
    public void aMissedAlarmsReportToo() throws Exception {
        MorningNotice n = MorningNotice.fromResponse(ID, 200,
            answer(ID, "Missed: nothing stopped it. It rang until 07:20 and reached level 5 of 5, Trying backups.", "Streak reset: this alarm wasn't answered."));
        assertEquals("Missed: nothing stopped it. It rang until 07:20 and reached level 5 of 5, Trying backups.", n.summary);
    }

    @Test
    public void nothingShownWithoutThatAlarmsReport() throws Exception {
        assertNull(MorningNotice.fromResponse(ID, 200, answer("someOtherAlarm", "x", "y")));
        assertNull(MorningNotice.fromResponse(ID, 200, "{\"ok\":true,\"data\":{\"reports\":[]}}"));
        assertNull(MorningNotice.fromResponse(ID, 401, answer(ID, "x", "y")));
        assertNull(MorningNotice.fromResponse(ID, -1, null));
        assertNull(MorningNotice.fromResponse(ID, 200, "<html>sign in</html>"));
    }
}
