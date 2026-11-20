package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.EscalationLadder.Level;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The native ladder: the same as lib/escalation.ts for every ladder the server
 * can put in a plan (shared table from lib/escalation.parity.test.ts), its
 * stage timing, and the unmissable override.
 */
public class EscalationLadderTest {

    static JSONObject table() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(new File("src/test/resources/escalation-cases.json").toPath()), "UTF-8"));
    }

    static String plan(String strategy, boolean critical, JSONArray escalation) throws Exception {
        JSONObject p = new JSONObject();
        p.put("version", 1);
        p.put("critical", critical);
        p.put("sound", new JSONObject().put("intensity", 60).put("strategy", strategy));
        if (escalation != null) {
            p.put("escalation", escalation);
        }
        return p.toString();
    }

    static void assertSameLevel(String where, JSONObject ts, Level l) throws Exception {
        assertEquals(where, ts.getInt("level"), l.level);
        assertEquals(where, ts.getInt("afterSeconds"), l.afterSeconds);
        assertEquals(where, ts.getString("label"), l.label);
        assertEquals(where, ts.getDouble("volumeFactor"), l.volumeFactor, 0);
        assertEquals(where, ts.getBoolean("vibrate"), l.vibrate);
        assertEquals(where, ts.getBoolean("requireVerification"), l.requireVerification);
        assertEquals(where, ts.getString("stage"), l.stage);
        List<String> backup = new ArrayList<>();
        for (int i = 0; i < ts.getJSONArray("backup").length(); i++) {
            backup.add(ts.getJSONArray("backup").getString(i));
        }
        assertEquals(where, backup, l.backup);
    }

    @Test
    public void theStandardLadderIsTheTypeScriptOne() throws Exception {
        JSONObject shared = table().getJSONObject("shared");
        for (String strategy : new String[] { "gentle", "adaptive", "aggressive" }) {
            JSONArray ts = shared.getJSONArray(strategy);
            List<Level> java = EscalationLadder.standard(strategy);
            assertEquals(ts.length(), java.size());
            for (int i = 0; i < ts.length(); i++) {
                assertSameLevel(strategy + " level " + (i + 1), ts.getJSONObject(i), java.get(i));
            }
        }
    }

    @Test
    public void aPersonalisedPlanIsClimbedExactlyAsTheServerWroteIt() throws Exception {
        JSONArray cases = table().getJSONArray("personalised");
        int checked = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            if (c.getBoolean("critical")) {
                continue;
            }
            EscalationLadder ladder = EscalationLadder.fromRingPlan(plan(c.getString("strategy"), false, c.getJSONArray("plan")));
            assertEquals("plan", ladder.source);
            JSONArray ts = c.getJSONArray("plan");
            for (int k = 0; k < ts.length(); k++) {
                assertSameLevel(c.getString("strategy") + "/" + c.getString("profile"), ts.getJSONObject(k), ladder.levels.get(k));
            }
            checked++;
        }
        assertEquals(12, checked);
    }

    @Test
    public void anUnmissableAlarmAlwaysGetsTheFullLadder() throws Exception {
        JSONArray cases = table().getJSONArray("personalised");
        JSONObject shared = table().getJSONObject("shared");
        int checked = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            String strategy = c.getString("strategy");
            // The override applies whatever the plan holds back: feed it the non-critical plan, marked critical.
            for (JSONArray personal : new JSONArray[] { c.getJSONArray("plan"), nonCriticalTwin(cases, c) }) {
                EscalationLadder ladder = EscalationLadder.fromRingPlan(plan(strategy, true, personal));
                assertTrue(ladder.critical);
                assertEquals(5, ladder.levels.size());
                List<Level> standard = EscalationLadder.standard(strategy);
                for (int k = 0; k < 5; k++) {
                    Level l = ladder.levels.get(k);
                    Level s = standard.get(k);
                    assertTrue("never later than standard", l.afterSeconds <= s.afterSeconds);
                    assertTrue("never later than the plan", l.afterSeconds <= personal.getJSONObject(k).getInt("afterSeconds"));
                    assertTrue(l.volumeFactor >= s.volumeFactor);
                    assertEquals(s.vibrate, l.vibrate);
                    assertEquals(s.requireVerification, l.requireVerification);
                    assertEquals(s.label, l.label);
                }
                assertEquals("every backup at the top", EscalationLadder.BACKUP_KINDS, ladder.top().backup);
                checked++;
            }
        }
        assertEquals("24 cases, each with its own plan and its non-critical twin", 48, checked);
        assertEquals(3, shared.length());
    }

    private static JSONArray nonCriticalTwin(JSONArray cases, JSONObject c) throws Exception {
        for (int i = 0; i < cases.length(); i++) {
            JSONObject o = cases.getJSONObject(i);
            if (o.getString("strategy").equals(c.getString("strategy")) && o.getString("profile").equals(c.getString("profile")) && !o.getBoolean("critical")) {
                return o.getJSONArray("plan");
            }
        }
        throw new AssertionError("no twin");
    }

    @Test
    public void anEasyWakersHeldBackBackupsStayHeldBackUnlessUnmissable() throws Exception {
        JSONArray held = null;
        JSONArray cases = table().getJSONArray("personalised");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            if (c.getString("profile").equals("easy") && c.getString("strategy").equals("adaptive") && !c.getBoolean("critical")) {
                held = c.getJSONArray("plan");
            }
        }
        assertTrue(EscalationLadder.fromRingPlan(plan("adaptive", false, held)).top().backup.isEmpty());
        EscalationLadder unmissable = EscalationLadder.fromRingPlan(plan("adaptive", true, held));
        assertEquals(EscalationLadder.BACKUP_KINDS, unmissable.top().backup);
        assertEquals("the easy waker's slower 94 s is capped at the standard 75 s", 75, unmissable.top().afterSeconds);
        assertEquals("Trying backups", unmissable.top().label);
    }

    @Test
    public void stageTimingFollowsTheLadderToTheMillisecond() {
        EscalationLadder adaptive = EscalationLadder.fromRingPlan(null);
        int[][] expect = { { 0, 1 }, { 9_999, 1 }, { 10_000, 2 }, { 21_999, 2 }, { 22_000, 3 }, { 34_999, 3 }, { 35_000, 4 }, { 74_999, 4 }, { 75_000, 5 }, { 1_200_000, 5 } };
        for (int[] e : expect) {
            assertEquals("at " + e[0] + " ms", e[1], adaptive.at(e[0]).level);
        }
        assertEquals(5, adaptive.top().level);
    }

    @Test
    public void aMissingOrNonsensicalLadderFallsBackToTheStandardOne() throws Exception {
        JSONArray startsLate = new JSONArray("[{\"level\":1,\"afterSeconds\":5,\"label\":\"x\",\"volumeFactor\":1,\"vibrate\":false,\"requireVerification\":false,\"backup\":[],\"stage\":\"ramp\"}]");
        JSONArray outOfOrder = new JSONArray("[{\"level\":1,\"afterSeconds\":0,\"label\":\"a\",\"volumeFactor\":1,\"vibrate\":false,\"requireVerification\":false,\"backup\":[],\"stage\":\"ramp\"},"
            + "{\"level\":3,\"afterSeconds\":30,\"label\":\"b\",\"volumeFactor\":1,\"vibrate\":true,\"requireVerification\":false,\"backup\":[],\"stage\":\"vibration\"},"
            + "{\"level\":2,\"afterSeconds\":40,\"label\":\"c\",\"volumeFactor\":1,\"vibrate\":false,\"requireVerification\":false,\"backup\":[],\"stage\":\"ramp\"}]");
        JSONArray unknownBackup = new JSONArray("[{\"level\":1,\"afterSeconds\":0,\"label\":\"a\",\"volumeFactor\":1,\"vibrate\":false,\"requireVerification\":false,\"backup\":[\"pager\"],\"stage\":\"ramp\"}]");
        for (String p : new String[] { null, "nope", plan("gentle", false, null), plan("gentle", false, new JSONArray()),
                plan("gentle", false, startsLate), plan("gentle", false, outOfOrder), plan("gentle", false, unknownBackup) }) {
            EscalationLadder l = EscalationLadder.fromRingPlan(p);
            assertTrue(String.valueOf(p), l.source.startsWith("standard"));
            assertEquals(5, l.levels.size());
        }
        assertEquals("the plan's strategy is kept", 20, EscalationLadder.fromRingPlan(plan("gentle", false, null)).levels.get(1).afterSeconds);
        assertFalse(EscalationLadder.fromRingPlan(plan("gentle", false, null)).critical);
    }
}
