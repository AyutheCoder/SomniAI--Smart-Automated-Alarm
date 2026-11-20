package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Scanner;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Folding Health Connect's records into nights, on the fixtures in resources/health-connect. */
public class HealthNightsTest {

    private static JSONObject fixture(String name) throws Exception {
        try (InputStream in = HealthNightsTest.class.getResourceAsStream("/health-connect/" + name + ".json");
             Scanner s = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            return new JSONObject(s.next());
        }
    }

    /** The same JSON, whatever the key order and number types. */
    private static boolean sameJson(Object a, Object b) throws Exception {
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject x = (JSONObject) a;
            JSONObject y = (JSONObject) b;
            if (x.length() != y.length()) {
                return false;
            }
            for (java.util.Iterator<String> keys = x.keys(); keys.hasNext(); ) {
                String k = keys.next();
                if (!y.has(k) || !sameJson(x.get(k), y.get(k))) {
                    return false;
                }
            }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray x = (JSONArray) a;
            JSONArray y = (JSONArray) b;
            if (x.length() != y.length()) {
                return false;
            }
            for (int i = 0; i < x.length(); i++) {
                if (!sameJson(x.get(i), y.get(i))) {
                    return false;
                }
            }
            return true;
        }
        if (a instanceof Number && b instanceof Number) {
            return ((Number) a).doubleValue() == ((Number) b).doubleValue();
        }
        return a.equals(b);
    }

    /** For other tests comparing the phone's JSON with a shared fixture. */
    static boolean sameJsonForTests(Object a, Object b) throws Exception {
        return sameJson(a, b);
    }

    private static HealthNights.Result fold(String name, ZoneId zone) throws Exception {
        JSONObject f = fixture(name);
        return HealthNights.fold(
            HealthNights.sessionsFrom(f.getJSONArray("sessions")),
            HealthNights.heartFrom(f.getJSONArray("restingHeartRate")),
            zone == null ? ZoneId.of(f.getString("zone")) : zone,
            Instant.parse(f.getString("now")));
    }

    @Test
    public void eachNightIsKeyedByItsWakeDate() throws Exception {
        HealthNights.Result r = fold("fortnight", null);
        assertEquals(List.of("2026-11-14", "2026-11-15", "2026-11-16"),
            r.nights.stream().map(n -> n.date).collect(Collectors.toList()));
    }

    @Test
    public void aNightWithStagesCountsOnlyTheTimeAsleep() throws Exception {
        HealthNights.Night n = fold("fortnight", null).nights.get(0);
        assertEquals("watch-night-14", n.session.id);
        assertEquals(480, n.session.inBedMinutes());
        // Light, deep, REM and light again; the 20 minutes awake in bed and 10 awake aren't sleep.
        assertEquals(450, n.session.asleepMinutes());
        assertTrue(n.session.hasStages());
        assertEquals(1, n.sessions);
        assertEquals(Long.valueOf(58), n.restingHr);
    }

    @Test
    public void severalSessionsInOneNightFoldToTheLongestAsThePaperDid() throws Exception {
        // A split night (2 h 30, then 4 h 30) and an afternoon nap: the longest is kept,
        // not the sum, as ai-brain/datasets/pmdata.py keeps one episode per night.
        HealthNights.Night n = fold("fortnight", null).nights.get(1);
        assertEquals("phone-night-15-second", n.session.id);
        assertEquals(3, n.sessions);
        assertEquals(270, n.session.asleepMinutes());
        // No stages recorded: time asleep is the session's length.
        assertFalse(n.session.hasStages());
        // Three readings that day: the median.
        assertEquals(Long.valueOf(62), n.restingHr);
    }

    @Test
    public void aNightOneAppRecordedOnlyInPartKeepsTheFullerRecord() throws Exception {
        HealthNights.Night n = fold("fortnight", null).nights.get(2);
        assertEquals("watch-night-16", n.session.id);
        assertEquals(2, n.sessions);
        assertEquals(430, n.session.asleepMinutes());
        // No resting heart rate recorded for that date: none, not a guess.
        assertNull(n.restingHr);
    }

    @Test
    public void aSessionStillBeingRecordedIsLeftForLater() throws Exception {
        HealthNights.Result r = fold("fortnight", null);
        assertEquals(List.of("watch-still-recording: in_progress"), r.skipped);
        assertTrue(r.nights.stream().noneMatch(n -> n.session.id.equals("watch-still-recording")));
    }

    @Test
    public void nothingRecordedIsNoNights() throws Exception {
        HealthNights.Result r = fold("empty", null);
        assertTrue(r.nights.isEmpty());
        assertTrue(r.skipped.isEmpty());
        assertEquals(0, HealthNights.toJson(r).getJSONArray("nights").length());
    }

    @Test
    public void theWakeDateIsThePhonesOwn() throws Exception {
        // In UTC the first part of the split night ends on the 14th, and the nap on the 15th.
        HealthNights.Result utc = fold("fortnight", ZoneId.of("UTC"));
        assertEquals(List.of("2026-11-14", "2026-11-15", "2026-11-16"),
            utc.nights.stream().map(n -> n.date).collect(Collectors.toList()));
        assertEquals(List.of(2, 2, 2), utc.nights.stream().map(n -> n.sessions).collect(Collectors.toList()));
        assertEquals("watch-night-14", utc.nights.get(0).session.id);
    }

    @Test
    public void thePhoneSendsExactlyWhatTheServersTestsUse() throws Exception {
        // tests/fixtures/health-connect/fortnight-nights.json, the server's and the web's fixture.
        String path = "../../tests/fixtures/health-connect/fortnight-nights.json";
        JSONObject expected = new JSONObject(new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)), StandardCharsets.UTF_8));
        JSONObject actual = HealthNights.toJson(fold("fortnight", null));
        assertTrue("the phone sent " + actual.toString(2), sameJson(expected, actual));
    }

    @Test
    public void heartRateWithoutSleepMakesNoNight() {
        HealthNights.Result r = HealthNights.fold(List.of(),
            List.of(new HealthNights.HeartRate(Instant.parse("2026-11-15T02:00:00Z"), 60)),
            ZoneId.of("Asia/Kolkata"), Instant.parse("2026-11-16T03:30:00Z"));
        assertTrue(r.nights.isEmpty());
    }

    @Test
    public void theServerGetsEachNightWithWhatItIsMadeOf() throws Exception {
        JSONObject json = HealthNights.toJson(fold("fortnight", null));
        JSONArray nights = json.getJSONArray("nights");
        JSONObject first = nights.getJSONObject(0);
        assertEquals("2026-11-14", first.getString("date"));
        assertEquals("2026-11-13T17:30:00Z", first.getString("sleepTime"));
        assertEquals("2026-11-14T01:30:00Z", first.getString("wakeTime"));
        assertEquals(450, first.getInt("asleepMinutes"));
        assertEquals(480, first.getInt("inBedMinutes"));
        assertTrue(first.getBoolean("stagesRecorded"));
        assertEquals(1, first.getInt("sessions"));
        assertEquals(58, first.getInt("restingHr"));
        assertEquals("com.example.watch", first.getString("origin"));
        assertFalse(nights.getJSONObject(2).has("restingHr"));
        assertEquals("watch-still-recording: in_progress", json.getJSONArray("skipped").getString(0));
    }
}
