package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Telemetry (prompt 5.1): nothing without consent, and the time to first
 * interaction taken on the monotonic clock, per ring.
 */
public class WakeTelemetryTest {

    /** The phone's storage: a string, as SharedPreferences holds it. */
    static final class Memory implements WakeTelemetry.Store {
        String json;
        int writes;

        @Override public String read() { return json; }
        @Override public void write(String j) { json = j; writes++; }
    }

    // Wall clock (epoch ms) and monotonic clock (elapsedRealtime ms) are unrelated numbers on a phone.
    static final long WALL = 1_794_619_800_000L; // 2026-11-14T01:30:00Z, 07:00 in India
    static final long BOOT = 9_000_000L;
    static final long SEVEN = WALL;

    static WakeTelemetry consenting(Memory m) {
        WakeTelemetry t = new WakeTelemetry(m);
        t.setConsent(true, "telemetry-v1", WALL - 86_400_000L);
        return t;
    }

    static Verification passed() {
        return new Verification(true, true, 1, 21_000, 3, 4, Arrays.asList("math", "math", "math"), 92, WALL);
    }

    @Test
    public void withoutConsentNothingIsRecordedAtAll() {
        Memory m = new Memory();
        WakeTelemetry t = new WakeTelemetry(m);
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.interacted(BOOT + 4_000, "screen");
        assertNull(t.ringEnded("a", "dismissed", WALL + 30_000, BOOT + 30_000, 2, "vibration", Verification.none(WALL), false));
        assertEquals(0, t.openWakes());
        assertNull("not even written to storage", m.json);
    }

    @Test
    public void consentGivenMidRingDoesntRecordThatRing() {
        Memory m = new Memory();
        WakeTelemetry t = new WakeTelemetry(m);
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.setConsent(true, "telemetry-v1", WALL + 5_000);
        t.interacted(BOOT + 6_000, "screen");
        assertNull("the ring began before consent", t.ringEnded("a", "dismissed", WALL + 30_000, BOOT + 30_000, 1, "ramp", null, false));
        // The next one is recorded.
        t.ringStarted("a", SEVEN + 86_400_000L, WALL + 86_400_000L, BOOT + 86_400_000L);
        assertEquals(1, t.openWakes());
    }

    @Test
    public void withdrawingDropsWhatWasOpenAndStopsRecording() {
        Memory m = new Memory();
        WakeTelemetry t = consenting(m);
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.ringEnded("a", "snoozed", WALL + 20_000, BOOT + 20_000, 1, "ramp", null, false);
        assertEquals(1, t.openWakes());
        assertEquals(1, t.setConsent(false, null, WALL + 60_000));
        assertEquals(0, t.openWakes());
        assertFalse(t.consent().granted);
        // The snooze rings: nothing.
        t.ringStarted("a", SEVEN, WALL + 300_000, BOOT + 300_000);
        assertNull(t.ringEnded("a", "dismissed", WALL + 320_000, BOOT + 320_000, 1, "ramp", null, false));
    }

    @Test
    public void theTimeToFirstInteractionIsOnTheMonotonicClock() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        // The wall clock jumps an hour (a time zone or network time change) mid-ring: no effect.
        t.interacted(BOOT + 4_250, "screen");
        JSONObject w = t.ringEnded("a", "dismissed", WALL + 3_600_000 + 30_000, BOOT + 30_000, 1, "ramp", Verification.none(WALL), false);
        assertEquals(4_250, w.getLong("firstInteractionMs"));
        assertEquals(30_000, w.getJSONArray("rings").getJSONObject(0).getLong("durationMs"));
        assertEquals("screen", w.getJSONArray("rings").getJSONObject(0).getString("via"));
    }

    @Test
    public void onlyTheFirstInteractionCountsAndOneBeforeTheRingIsIgnored() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.interacted(BOOT - 500, "key");
        t.interacted(BOOT + 7_000, "key");
        t.interacted(BOOT + 9_000, "screen");
        JSONObject w = t.ringEnded("a", "dismissed", WALL + 30_000, BOOT + 30_000, 1, "ramp", Verification.none(WALL), false);
        assertEquals(7_000, w.getLong("firstInteractionMs"));
        assertEquals("key", w.getJSONArray("rings").getJSONObject(0).getString("via"));
    }

    @Test
    public void anEventIsTimedByItsOwnTimestampNotByWhenItWasHandled() {
        // A touch at uptime 50_000, handled 180 ms later, when uptime is 50_180 and elapsed is 80_180.
        assertEquals(80_000, WakeTelemetry.elapsedOfEvent(50_000, 50_180, 80_180));
        // An event stamped "in the future" (clock quirks) is taken as now, never later.
        assertEquals(80_180, WakeTelemetry.elapsedOfEvent(50_200, 50_180, 80_180));
    }

    @Test
    public void nobodyTouchedIt() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        JSONObject w = t.ringEnded("a", "unanswered", WALL + 1_200_000, BOOT + 1_200_000, 5, "backup", null, true);
        assertTrue(w.isNull("firstInteractionMs"));
        assertEquals("unanswered", w.getString("outcome"));
        assertEquals(5, w.getJSONObject("stageReached").getInt("level"));
        assertEquals("backup", w.getJSONObject("stageReached").getString("stage"));
        assertEquals("not_passed", w.getJSONObject("verification").getString("result"));
    }

    /** Snoozed twice, then stopped after the wake check: tests/fixtures/telemetry/snoozed-wake.json. */
    static JSONObject snoozedTwiceThenChecked(String id) {
        Memory m = new Memory();
        WakeTelemetry t = consenting(m);
        t.ringStarted(id, SEVEN, WALL, BOOT);
        t.interacted(BOOT + 12_000, "screen");
        t.ringEnded(id, "snoozed", WALL + 15_000, BOOT + 15_000, 1, "ramp", null, true);
        t = new WakeTelemetry(m);
        long r2 = 15_000 + RingController.SNOOZE_MS;
        t.ringStarted(id, SEVEN + r2, WALL + r2, BOOT + r2);
        t.interacted(BOOT + r2 + 3_000, "notification");
        t.ringEnded(id, "snoozed", WALL + r2 + 5_000, BOOT + r2 + 5_000, 2, "vibration", null, true);
        long r3 = r2 + 5_000 + RingController.SNOOZE_MS;
        t.ringStarted(id, SEVEN + r3, WALL + r3, BOOT + r3);
        t.interacted(BOOT + r3 + 61_000, "screen");
        return t.ringEnded(id, "dismissed", WALL + r3 + 90_000, BOOT + r3 + 90_000, 3, "challenge", passed(), true);
    }

    @Test
    public void thePhoneSendsExactlyWhatTheServersTestsUse() throws Exception {
        String path = "../../tests/fixtures/telemetry/snoozed-wake.json";
        JSONObject expected = new JSONObject(new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)), java.nio.charset.StandardCharsets.UTF_8));
        JSONObject actual = snoozedTwiceThenChecked("64f0a1b2c3d4e5f601234567");
        assertTrue("the phone sent " + actual.toString(2), HealthNightsTest.sameJsonForTests(expected, actual));
    }

    @Test
    public void snoozesAreCountedAcrossTheRingsOfOneWake() throws Exception {
        Memory m = new Memory();
        WakeTelemetry t = consenting(m);
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.interacted(BOOT + 12_000, "screen");
        assertNull(t.ringEnded("a", "snoozed", WALL + 15_000, BOOT + 15_000, 1, "ramp", null, true));
        // Five minutes later; the process may have died between, so this is a fresh object on the same storage.
        t = new WakeTelemetry(m);
        long r2 = 15_000 + RingController.SNOOZE_MS;
        t.ringStarted("a", SEVEN + r2, WALL + r2, BOOT + r2);
        t.interacted(BOOT + r2 + 3_000, "notification");
        assertNull(t.ringEnded("a", "snoozed", WALL + r2 + 5_000, BOOT + r2 + 5_000, 2, "vibration", null, true));
        long r3 = r2 + 5_000 + RingController.SNOOZE_MS;
        t.ringStarted("a", SEVEN + r3, WALL + r3, BOOT + r3);
        t.interacted(BOOT + r3 + 61_000, "screen");
        JSONObject w = t.ringEnded("a", "dismissed", WALL + r3 + 90_000, BOOT + r3 + 90_000, 3, "challenge", passed(), true);

        assertEquals(2, w.getInt("snoozes"));
        assertEquals("the wake keeps the occurrence that rang first", WakeTelemetry.iso(SEVEN), w.getString("scheduledFor"));
        assertEquals(WakeTelemetry.iso(WALL), w.getString("firstRingAt"));
        assertEquals(12_000, w.getLong("firstInteractionMs"));
        JSONArray rings = w.getJSONArray("rings");
        assertEquals(3, rings.length());
        assertEquals(Arrays.asList(12_000L, 3_000L, 61_000L), Arrays.asList(rings.getJSONObject(0).getLong("firstInteractionMs"),
            rings.getJSONObject(1).getLong("firstInteractionMs"), rings.getJSONObject(2).getLong("firstInteractionMs")));
        assertEquals(Arrays.asList("snoozed", "snoozed", "dismissed"), Arrays.asList(rings.getJSONObject(0).getString("outcome"),
            rings.getJSONObject(1).getString("outcome"), rings.getJSONObject(2).getString("outcome")));
        assertEquals("the highest stage any ring reached", 3, w.getJSONObject("stageReached").getInt("level"));
        assertEquals("challenge", w.getJSONObject("stageReached").getString("stage"));
        JSONObject v = w.getJSONObject("verification");
        assertEquals("passed", v.getString("result"));
        assertEquals(4, v.getInt("attempts"));
        assertEquals(3, v.getInt("steps"));
        assertEquals(21_000, v.getLong("timeOnTaskMs"));
        assertEquals(0, t.openWakes());
    }

    @Test
    public void aWakeWithoutACheckSaysSo() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        JSONObject w = t.ringEnded("a", "dismissed", WALL + 9_000, BOOT + 9_000, 1, "ramp", Verification.none(WALL), false);
        assertEquals("not_required", w.getJSONObject("verification").getString("result"));
        assertFalse(w.getJSONObject("verification").getBoolean("required"));
    }

    @Test
    public void twoAlarmsRingingTogetherEachGetTheInteraction() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.ringStarted("b", SEVEN, WALL + 2_000, BOOT + 2_000);
        t.interacted(BOOT + 10_000, "screen");
        assertEquals(10_000, t.ringEnded("a", "dismissed", WALL + 20_000, BOOT + 20_000, 1, "ramp", Verification.none(WALL), false).getLong("firstInteractionMs"));
        assertEquals("from b's own start", 8_000, t.ringEnded("b", "dismissed", WALL + 20_000, BOOT + 20_000, 1, "ramp", Verification.none(WALL), false).getLong("firstInteractionMs"));
    }

    @Test
    public void aRingRestartedByAndroidMidRingIsMarkedInterruptedInTheSameWake() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.ringStarted("a", SEVEN, WALL + 40_000, BOOT + 40_000);
        t.interacted(BOOT + 45_000, "screen");
        JSONObject w = t.ringEnded("a", "dismissed", WALL + 50_000, BOOT + 50_000, 1, "ramp", Verification.none(WALL), false);
        assertEquals("interrupted", w.getJSONArray("rings").getJSONObject(0).getString("outcome"));
        assertEquals(40_000, w.getJSONArray("rings").getJSONObject(0).getLong("durationMs"));
        assertEquals(5_000, w.getJSONArray("rings").getJSONObject(1).getLong("firstInteractionMs"));
        assertTrue("the first ring had none", w.isNull("firstInteractionMs"));
    }

    @Test
    public void aSnoozeThatNeverRangIsDroppedLaterNotSent() {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.ringEnded("a", "snoozed", WALL + 10_000, BOOT + 10_000, 1, "ramp", null, false);
        // The alarm was deleted, so its snooze never rang. Hours later another alarm rings.
        t.ringStarted("b", SEVEN, WALL + WakeTelemetry.STALE_MS + 60_000, BOOT + WakeTelemetry.STALE_MS + 60_000);
        assertEquals(1, t.openWakes());
    }

    @Test
    public void clearingDropsEverythingOpen() {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.ringStarted("b", SEVEN, WALL, BOOT);
        assertEquals(2, t.clear());
        assertEquals(0, t.openWakes());
        assertTrue("consent stays as it was", t.consent().granted);
    }

    @Test
    public void whatIsSentHasTimingsAndOutcomesOnly() throws Exception {
        WakeTelemetry t = consenting(new Memory());
        t.ringStarted("a", SEVEN, WALL, BOOT);
        t.interacted(BOOT + 1_000, "screen");
        JSONObject w = t.ringEnded("a", "dismissed", WALL + 9_000, BOOT + 9_000, 1, "ramp", passed(), true);
        java.util.List<String> keys = new java.util.ArrayList<>();
        for (Iterator<String> k = w.keys(); k.hasNext(); ) {
            keys.add(k.next());
        }
        Collections.sort(keys);
        assertEquals(Arrays.asList("alarmId", "consentVersion", "endedAt", "firstInteractionMs", "firstRingAt", "outcome", "rings",
            "scheduledFor", "snoozes", "stageReached", "verification"), keys);
        assertEquals("telemetry-v1", w.getString("consentVersion"));
        assertFalse("the monotonic clock's raw values stay on the phone", w.getJSONArray("rings").getJSONObject(0).has("startElapsed"));
    }

    @Test
    public void unreadableStorageMeansNoConsent() {
        Memory m = new Memory();
        m.json = "{not json";
        WakeTelemetry t = new WakeTelemetry(m);
        assertFalse(t.consent().granted);
        t.ringStarted("a", SEVEN, WALL, BOOT);
        assertEquals(0, t.openWakes());
    }
}
