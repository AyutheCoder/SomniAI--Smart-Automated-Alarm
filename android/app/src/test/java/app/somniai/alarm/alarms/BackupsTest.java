package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.time.Instant;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The backup level on the phone (3.3): what the server says each channel did,
 * checked, never trusted, as lib/backupClient.ts does on the web.
 */
public class BackupsTest {

    static final List<String> ALL = EscalationLadder.BACKUP_KINDS;
    static final String RECEIPT = "{\"transport\":\"fcm\",\"messageId\":\"projects/p/messages/1\",\"at\":\"2026-10-28T07:01:15Z\"}";

    static String answer(String outcomes, String later) {
        return "{\"ok\":true,\"data\":{\"outcomes\":[" + outcomes + "],\"later\":[" + later + "]}}";
    }

    @Test
    public void theRequestNamesTheKindsAndThisDevice() throws Exception {
        JSONObject r = Backups.request(ALL, "my-token");
        assertEquals(new JSONArray(ALL).toString(), r.getJSONArray("kinds").toString());
        assertEquals("my-token", r.getString("fromToken"));
        assertFalse("no token, none sent", Backups.request(ALL, null).has("fromToken"));
    }

    @Test
    public void eachKindGetsTheServersCheckedAnswer() {
        Backups.Answer a = Backups.fromResponse(ALL, 200, answer(
            "{\"kind\":\"secondaryAlarm\",\"status\":\"delivered\",\"receipt\":" + RECEIPT + "},"
                + "{\"kind\":\"smartwatch\",\"status\":\"not_configured\",\"reason\":\"no watch app\"},"
                + "{\"kind\":\"emergencyContact\",\"status\":\"failed\",\"reason\":\"Twilio 400 21608: unverified\"}", ""));
        assertEquals(3, a.outcomes.size());
        assertEquals("delivered", a.outcomes.get(0).status);
        assertEquals("not_configured", a.outcomes.get(1).status);
        assertEquals("no watch app", a.outcomes.get(1).reason);
        assertEquals("failed", a.outcomes.get(2).status);
        assertTrue(a.rangAnotherDevice());
    }

    @Test
    public void deliveredWithoutAReceiptAnUnknownStatusOrSilenceIsAFailure() {
        Backups.Answer a = Backups.fromResponse(ALL, 200, answer(
            "{\"kind\":\"secondaryAlarm\",\"status\":\"delivered\"},"
                + "{\"kind\":\"smartwatch\",\"status\":\"triggered\"}", ""));
        for (Backups.Outcome o : a.outcomes) {
            assertEquals(o.kind, "failed", o.status);
        }
        assertEquals("reported delivered without a receipt", a.outcomes.get(0).reason);
        assertEquals("the server didn't answer for it", a.outcomes.get(2).reason);
        assertFalse("not rung: no receipt", a.rangAnotherDevice());
        // A receipt missing its id or time doesn't count either.
        Backups.Answer noId = Backups.fromResponse(List.of("secondaryAlarm"), 200,
            answer("{\"kind\":\"secondaryAlarm\",\"status\":\"delivered\",\"receipt\":{\"transport\":\"fcm\",\"messageId\":\" \",\"at\":\"2026-10-28T07:01:15Z\"}}", ""));
        assertEquals("failed", noId.outcomes.get(0).status);
    }

    @Test
    public void unreachableRefusedOrUnreadableIsAFailureForEveryKind() {
        assertEquals("couldn't reach the server", Backups.fromResponse(ALL, -1, null).outcomes.get(0).reason);
        assertEquals("the server said 401", Backups.fromResponse(ALL, 401, "{}").outcomes.get(1).reason);
        assertEquals("the server's answer couldn't be read", Backups.fromResponse(ALL, 200, "<html>").outcomes.get(2).reason);
        for (int status : new int[] { -1, 401, 500 }) {
            for (Backups.Outcome o : Backups.fromResponse(ALL, status, null).outcomes) {
                assertEquals("failed", o.status);
            }
        }
    }

    @Test
    public void peopleToldLaterAreNotOutcomesYet() {
        Backups.Answer a = Backups.fromResponse(ALL, 200, answer(
            "{\"kind\":\"secondaryAlarm\",\"status\":\"not_configured\",\"reason\":\"no other device\"},"
                + "{\"kind\":\"smartwatch\",\"status\":\"not_configured\",\"reason\":\"no watch app\"}",
            "{\"who\":\"buddy\",\"name\":\"Bo\",\"at\":\"2026-10-28T07:15:00Z\"},"
                + "{\"who\":\"emergencyContact\",\"name\":\"Mum\",\"at\":\"2026-10-28T07:15:00Z\"},"
                + "{\"who\":\"stranger\",\"name\":\"X\",\"at\":\"2026-10-28T07:15:00Z\"},"
                + "{\"who\":\"buddy\",\"name\":\"\",\"at\":\"2026-10-28T07:15:00Z\"}"));
        assertEquals(List.of("secondaryAlarm", "smartwatch"), List.of(a.outcomes.get(0).kind, a.outcomes.get(1).kind));
        assertEquals(2, a.outcomes.size());
        assertEquals("only well-formed people", 2, a.later.size());
        assertEquals(Instant.parse("2026-10-28T07:15:00Z").toEpochMilli(), a.later.get(0).at);
        assertEquals("Your buddy Bo and Mum will be told at 07:15 if you haven't answered.",
            Backups.laterLine(a.later, t -> Instant.ofEpochMilli(t).toString().substring(11, 16)));
        assertNull(Backups.laterLine(List.of(), t -> ""));
    }

    @Test
    public void theyAreSentAsTheEscalateRouteTakesThem() throws Exception {
        JSONArray json = Backups.toJson(Backups.failedAll(List.of("smartwatch"), "x").outcomes);
        assertEquals(1, json.length());
        assertEquals("smartwatch", json.getJSONObject(0).getString("kind"));
        assertEquals("failed", json.getJSONObject(0).getString("status"));
        assertEquals("only what the route validates", 2, json.getJSONObject(0).length());
    }
}
