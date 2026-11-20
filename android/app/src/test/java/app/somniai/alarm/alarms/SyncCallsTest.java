package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.stream.Collectors;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The calls one ring sends: the same paths and order as lib/ringFlow.ts
 * syncCalls, the fields the server's verify and dismiss routes read, and "at"
 * on each for when it happened.
 */
public class SyncCallsTest {

    static final long RANG = 1_792_996_800_000L; // 2026-10-26T06:40:00Z
    static final String ID = "64f0a1b2c3d4e5f601234567";

    static List<String> paths(List<SyncCalls.Call> calls) {
        return calls.stream().map(c -> c.path).collect(Collectors.toList());
    }

    @Test
    public void aVerifiedDismissalSendsFireVerifyEscalateDismissInOrder() throws Exception {
        Verification v = new Verification(true, true, 1.0, 9_000, 3, 1, List.of("math"), 88, RANG + 40_000);
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "dismissed", RANG + 42_000, v, 5,
            Backups.failedAll(EscalationLadder.BACKUP_KINDS, "couldn't reach the server").outcomes);
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/verify", "/api/alarms/" + ID + "/escalate", "/api/alarms/" + ID + "/dismiss"), paths(calls));

        assertEquals("2026-10-26T06:40:00Z", calls.get(0).body.getString("at"));
        JSONObject verify = calls.get(1).body;
        assertEquals(true, verify.getBoolean("solved"));
        assertEquals(1.0, verify.getDouble("correctness"), 0);
        assertEquals(9_000, verify.getLong("responseMs"));
        assertEquals("three sums: the server judges speed per answer", 3, verify.getInt("steps"));
        assertEquals(1, verify.getInt("attempts"));
        assertEquals("math", verify.getJSONArray("methods").getString(0));
        assertEquals("2026-10-26T06:40:40Z", verify.getString("at"));
        assertFalse("the server scores it; the phone's score is not sent", verify.has("confidence") || verify.has("score"));
        JSONObject escalate = calls.get(2).body;
        assertEquals(5, escalate.getInt("level"));
        assertEquals(3, escalate.getJSONArray("backups").length());
        assertEquals("failed", escalate.getJSONArray("backups").getJSONObject(0).getString("status"));
        assertEquals("secondaryAlarm", escalate.getJSONArray("backups").getJSONObject(0).getString("kind"));
        assertEquals("2026-10-26T06:40:42Z", escalate.getString("at"));
        JSONObject dismiss = calls.get(3).body;
        assertEquals(42_000, dismiss.getLong("responseMs"));
        assertEquals("2026-10-26T06:40:42Z", dismiss.getString("at"));
        assertFalse("verified is the server's to decide", dismiss.has("verified"));
    }

    @Test
    public void aDismissalWithoutACheckSkipsVerifyButStillSaysTheLevelItTook() throws Exception {
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "dismissed", RANG + 5_000, Verification.none(RANG + 5_000), 1, List.of());
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/escalate", "/api/alarms/" + ID + "/dismiss"), paths(calls));
        assertEquals(1, calls.get(1).body.getInt("level"));
        assertEquals(0, calls.get(1).body.getJSONArray("backups").length());
    }

    @Test
    public void anUnansweredRingSendsTheFireAndThatItWasMissed() throws Exception {
        // Prompt 3.4: a missed alarm has a morning report, and the escalation
        // profile learns that the whole ladder wasn't enough. It used to send
        // only the fire, as there was no wake level to learn from.
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "unanswered", RANG + 1_200_000, null, 5, List.of());
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/missed"), paths(calls));
        JSONObject missed = calls.get(1).body;
        assertEquals(SyncCalls.iso(RANG + 1_200_000), missed.getString("at"));
        assertEquals(5, missed.getInt("level"));
        assertTrue(missed.getBoolean("rang"));
    }

    @Test
    public void anInterruptedRingSendsOnlyTheFire() {
        // The service was stopped mid-ring: nobody knows whether it was heard.
        assertEquals(List.of("/api/alarms/" + ID + "/fire"), paths(SyncCalls.forRing(ID, RANG, "interrupted", RANG + 60_000, null, 2, List.of())));
    }

    @Test
    public void theFireAloneIsWhatARingSendsAsItStarts() throws Exception {
        // D-001 (8.1): queued at the ring's start, so a ring killed mid-way still left a trace.
        SyncCalls.Call fire = SyncCalls.fire(ID, RANG);
        assertEquals("/api/alarms/" + ID + "/fire", fire.path);
        assertEquals("2026-10-26T06:40:00Z", fire.body.getString("at"));
        // The same call forRing begins with: the server can't tell them apart.
        SyncCalls.Call first = SyncCalls.forRing(ID, RANG, "unanswered", RANG + 60_000, null, 5, List.of()).get(0);
        assertEquals(first.path, fire.path);
        assertEquals(first.body.toString(), fire.body.toString());
    }

    @Test
    public void theEndingNeverSendsTheFireAgain() {
        // Fire at the start plus this at the end is exactly what forRing sent in one go.
        Verification v = new Verification(true, true, 1.0, 9_000, 3, 1, List.of("math"), 88, RANG + 40_000);
        for (String outcome : List.of("dismissed", "snoozed", "unanswered", "interrupted")) {
            List<SyncCalls.Call> whole = SyncCalls.forRing(ID, RANG, outcome, RANG + 42_000, v, 4, List.of());
            List<SyncCalls.Call> after = SyncCalls.afterFire(ID, RANG, outcome, RANG + 42_000, v, 4, List.of());
            assertFalse(outcome, paths(after).contains("/api/alarms/" + ID + "/fire"));
            assertEquals(outcome, paths(whole).subList(1, whole.size()), paths(after));
        }
        assertEquals(List.of(), paths(SyncCalls.afterFire(ID, RANG, "interrupted", RANG + 60_000, null, 2, List.of())));
    }

    @Test
    public void aSnoozeSendsFireThenSnoozeWithWhenItRingsAgain() throws Exception {
        // As the web's syncCalls: fire, then the snooze; nothing else until the wake ends.
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "snoozed", RANG + 20_000, null, 2, List.of());
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/snooze"), paths(calls));
        JSONObject s = calls.get(1).body;
        assertEquals(5, s.getInt("snoozeMinutes"));
        assertEquals("2026-10-26T06:45:20Z", s.getString("until"));
        assertEquals(20_000, s.getLong("responseMs"));
        assertEquals("2026-10-26T06:40:20Z", s.getString("at"));
    }
}
