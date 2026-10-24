package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

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
    public void aVerifiedDismissalSendsFireVerifyDismissInOrder() throws Exception {
        Verification v = new Verification(true, true, 1.0, 9_000, 1, List.of("math"), 88, RANG + 40_000);
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "dismissed", RANG + 42_000, v);
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/verify", "/api/alarms/" + ID + "/dismiss"), paths(calls));

        assertEquals("2026-10-26T06:40:00Z", calls.get(0).body.getString("at"));
        JSONObject verify = calls.get(1).body;
        assertEquals(true, verify.getBoolean("solved"));
        assertEquals(1.0, verify.getDouble("correctness"), 0);
        assertEquals(9_000, verify.getLong("responseMs"));
        assertEquals(1, verify.getInt("attempts"));
        assertEquals("math", verify.getJSONArray("methods").getString(0));
        assertEquals("2026-10-26T06:40:40Z", verify.getString("at"));
        assertFalse("the server scores it; the phone's score is not sent", verify.has("confidence") || verify.has("score"));
        JSONObject dismiss = calls.get(2).body;
        assertEquals(42_000, dismiss.getLong("responseMs"));
        assertEquals("2026-10-26T06:40:42Z", dismiss.getString("at"));
        assertFalse("verified is the server's to decide", dismiss.has("verified"));
    }

    @Test
    public void aDismissalWithoutACheckSkipsVerify() {
        List<SyncCalls.Call> calls = SyncCalls.forRing(ID, RANG, "dismissed", RANG + 5_000, Verification.none(RANG + 5_000));
        assertEquals(List.of("/api/alarms/" + ID + "/fire", "/api/alarms/" + ID + "/dismiss"), paths(calls));
    }

    @Test
    public void anUnansweredRingSendsOnlyTheFire() {
        assertEquals(List.of("/api/alarms/" + ID + "/fire"), paths(SyncCalls.forRing(ID, RANG, "unanswered", RANG + 1_200_000, null)));
    }
}
