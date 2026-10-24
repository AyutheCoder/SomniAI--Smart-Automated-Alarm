package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.json.JSONArray;
import org.junit.Test;

/** The backup stage reports what each channel did, and claims nothing it didn't do. */
public class BackupsTest {

    @Test
    public void withNoTransportEveryChannelSaysItIsNotSetUp() {
        List<Backups.Outcome> out = Backups.tryAll(EscalationLadder.BACKUP_KINDS);
        assertEquals(3, out.size());
        for (Backups.Outcome o : out) {
            assertEquals("not_configured", o.status);
            assertTrue(o.reason, o.reason.contains("set up"));
        }
        assertEquals("emergencyContact", out.get(2).kind);
        assertTrue(out.get(2).reason.contains("emergency contact"));
    }

    @Test
    public void theyAreSentAsTheEscalateRouteTakesThem() throws Exception {
        JSONArray json = Backups.toJson(Backups.tryAll(List.of("smartwatch")));
        assertEquals(1, json.length());
        assertEquals("smartwatch", json.getJSONObject(0).getString("kind"));
        assertEquals("not_configured", json.getJSONObject(0).getString("status"));
        assertEquals("only what the route validates", 2, json.getJSONObject(0).length());
    }
}
