package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Scanner;
import java.util.Set;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Screen time before bed, windowed from usage events (resources/screen-time). */
public class ScreenNightsTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Set<String> NONE = Set.of();

    private static JSONObject fixture() throws Exception {
        try (InputStream in = ScreenNightsTest.class.getResourceAsStream("/screen-time/week.json");
             Scanner s = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            return new JSONObject(s.next());
        }
    }

    private static ScreenNights.Result week(Instant now) throws Exception {
        JSONObject f = fixture();
        List<ScreenNights.Event> events = ScreenNights.eventsFrom(f.getJSONArray("events"));
        Set<String> excluded = new HashSet<>();
        JSONArray ex = f.getJSONArray("excluded");
        for (int i = 0; i < ex.length(); i++) {
            excluded.add(ex.getString(i));
        }
        return ScreenNights.measure(events, excluded, ScreenNights.bedtimesFrom(f.getJSONObject("bedtimes")),
            events.get(0).at, ZoneId.of(f.getString("zone")), now == null ? Instant.parse(f.getString("now")) : now);
    }

    private static ScreenNights.Night night(ScreenNights.Result r, String date) {
        return r.nights.stream().filter(n -> n.date.equals(date)).findFirst().orElseThrow();
    }

    private static ScreenNights.Event ev(String at, int type, String pkg) {
        return new ScreenNights.Event(Instant.parse(at), type, pkg, "Main");
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

    @Test
    public void theWindowIsTheThreeHoursBeforeBed() throws Exception {
        // 13th: bed 22:40; video 20:00-21:30 and chat 22:10-22:40 are both inside 19:40-22:40.
        ScreenNights.Night n = night(week(null), "2026-11-13");
        assertEquals(Instant.parse("2026-11-12T17:10:00Z"), n.bedtime);
        assertEquals(120, n.minutes);
        assertEquals("phone", n.bedtimeFrom);
        assertEquals(180, ScreenNights.WINDOW_MINUTES);
    }

    @Test
    public void aUseThatStartedBeforeTheWindowCountsOnlyInsideIt() throws Exception {
        // 14th: bed 23:00, window from 20:00. The browser ran 19:00-20:30: 30 minutes count, not 90.
        ScreenNights.Night n = night(week(null), "2026-11-14");
        assertEquals(Instant.parse("2026-11-13T17:30:00Z"), n.bedtime);
        assertEquals(30 + 75 + 30, n.minutes);
    }

    @Test
    public void twoAppsOnScreenAtOnceCountOnce() {
        List<ScreenNights.Interval> uses = ScreenNights.inUse(List.of(
            ev("2026-11-13T15:30:00Z", ScreenNights.RESUMED, "video"),
            ev("2026-11-13T16:00:00Z", ScreenNights.RESUMED, "chat"),
            ev("2026-11-13T16:30:00Z", ScreenNights.PAUSED, "video"),
            ev("2026-11-13T16:45:00Z", ScreenNights.PAUSED, "chat")), NONE, Instant.parse("2026-11-14T00:00:00Z"));
        assertEquals(1, uses.size());
        assertEquals(75, ScreenNights.minutesBetween(uses, Instant.parse("2026-11-13T00:00:00Z"), Instant.parse("2026-11-14T00:00:00Z")));
    }

    @Test
    public void theScreenGoingOffOrThePhoneShuttingDownEndsAUse() {
        Instant end = Instant.parse("2026-11-14T00:00:00Z");
        Instant from = Instant.parse("2026-11-13T00:00:00Z");
        // Never paused: the screen went off.
        assertEquals(30, ScreenNights.minutesBetween(ScreenNights.inUse(List.of(
            ev("2026-11-13T17:00:00Z", ScreenNights.RESUMED, "reader"),
            ev("2026-11-13T17:30:00Z", ScreenNights.SCREEN_OFF, "android")), NONE, end), from, end));
        assertEquals(10, ScreenNights.minutesBetween(ScreenNights.inUse(List.of(
            ev("2026-11-13T17:00:00Z", ScreenNights.RESUMED, "reader"),
            ev("2026-11-13T17:10:00Z", ScreenNights.SHUTDOWN, "android")), NONE, end), from, end));
        // Still open: counted up to now, not beyond.
        assertEquals(20, ScreenNights.minutesBetween(ScreenNights.inUse(List.of(
            ev("2026-11-13T17:00:00Z", ScreenNights.RESUMED, "reader")), NONE, Instant.parse("2026-11-13T17:20:00Z")), from, end));
    }

    @Test
    public void theHomeScreenAndSystemUiAreNotScreenTime() {
        Instant end = Instant.parse("2026-11-14T00:00:00Z");
        List<ScreenNights.Interval> uses = ScreenNights.inUse(List.of(
            ev("2026-11-13T16:00:00Z", ScreenNights.RESUMED, "com.example.launcher"),
            ev("2026-11-13T17:00:00Z", ScreenNights.PAUSED, "com.example.launcher"),
            ev("2026-11-13T17:00:00Z", ScreenNights.RESUMED, "com.example.chat"),
            ev("2026-11-13T17:05:00Z", ScreenNights.PAUSED, "com.example.chat")),
            Set.of("com.example.launcher", "com.android.systemui"), end);
        assertEquals(5, ScreenNights.minutesBetween(uses, Instant.parse("2026-11-13T00:00:00Z"), end));
    }

    @Test
    public void aPhoneCallIsNotScreenTime() {
        // The in-call screen stays "resumed" for the whole call while the screen is dark
        // against the ear: on the test phone that was 152 minutes Digital Wellbeing didn't count.
        Instant end = Instant.parse("2026-11-14T00:00:00Z");
        Instant from = Instant.parse("2026-11-13T00:00:00Z");
        for (String[] screen : new String[][] {
            { "com.android.incallui", "com.android.incallui.InCallActivity" },
            { "com.google.android.dialer", "com.android.incallui.InCallActivity" },
            { "com.samsung.android.incallui", "com.android.incallui.InCallActivity" },
        }) {
            List<ScreenNights.Interval> uses = ScreenNights.inUse(List.of(
                new ScreenNights.Event(Instant.parse("2026-11-13T05:08:00Z"), ScreenNights.RESUMED, screen[0], screen[1]),
                new ScreenNights.Event(Instant.parse("2026-11-13T05:34:00Z"), ScreenNights.PAUSED, screen[0], screen[1]),
                ev("2026-11-13T05:34:00Z", ScreenNights.RESUMED, "com.whatsapp"),
                ev("2026-11-13T05:40:00Z", ScreenNights.PAUSED, "com.whatsapp")), NONE, end);
            assertEquals(screen[0], 6, ScreenNights.minutesBetween(uses, from, end));
        }
        // The Phone app's own screens (dialling, contacts) are still screen time.
        assertEquals(3, ScreenNights.minutesBetween(ScreenNights.inUse(List.of(
            new ScreenNights.Event(Instant.parse("2026-11-13T05:00:00Z"), ScreenNights.RESUMED, "com.google.android.dialer", "com.google.android.dialer.extensions.GoogleDialtactsActivity"),
            new ScreenNights.Event(Instant.parse("2026-11-13T05:03:00Z"), ScreenNights.PAUSED, "com.google.android.dialer", "com.google.android.dialer.extensions.GoogleDialtactsActivity")),
            NONE, end), from, end));
    }

    @Test
    public void theSleepLogsBedtimeIsUsedWhenThereIsOne() throws Exception {
        // 15th: the video ran on until 23:30, but the sleep log says bed was 22:00.
        ScreenNights.Night n = night(week(null), "2026-11-15");
        assertEquals("sleep_log", n.bedtimeFrom);
        assertEquals(Instant.parse("2026-11-14T16:30:00Z"), n.bedtime);
        assertEquals(60, n.minutes);
    }

    @Test
    public void aShortCheckInTheNightIsNotBed() throws Exception {
        // 14th: a 4-minute look at 02:10; bed stays 23:00, and the check isn't screen time before bed.
        assertEquals(Instant.parse("2026-11-13T17:30:00Z"), night(week(null), "2026-11-14").bedtime);
    }

    @Test
    public void aQuietEveningIsAFewMinutesAndANightNotOverIsSettledOnceUp() throws Exception {
        // 16th, read at 10:00: up at 07:30, so last night is known.
        ScreenNights.Night n = night(week(null), "2026-11-16");
        assertEquals(Instant.parse("2026-11-15T16:20:00Z"), n.bedtime);
        assertEquals(5, n.minutes);
    }

    @Test
    public void tonightIsLeftForLaterWhileStillAsleep() throws Exception {
        // Read at 03:00 on the 16th: the phone was put down at 21:50 and the night isn't over.
        ScreenNights.Result r = week(Instant.parse("2026-11-15T21:30:00Z"));
        assertTrue(r.skipped.contains("2026-11-16: in_progress"));
        assertTrue(r.nights.stream().noneMatch(n -> n.date.equals("2026-11-16")));
    }

    @Test
    public void nightsBeforeThePhonesRecordsAreSkippedNotZero() throws Exception {
        ScreenNights.Result r = week(null);
        assertEquals(List.of("2026-11-10: before_records", "2026-11-11: before_records", "2026-11-12: before_records"), r.skipped);
        // No records at all: nothing measured, every night says why.
        ScreenNights.Result none = ScreenNights.measure(List.of(), NONE, Map.of(), null, INDIA, Instant.parse("2026-11-16T04:30:00Z"));
        assertTrue(none.nights.isEmpty());
        assertEquals(ScreenNights.DAYS, none.skipped.size());
        assertTrue(none.skipped.stream().allMatch(s -> s.endsWith(": before_records")));
        // A sleep-log bedtime whose window starts before the records: skipped too.
        ScreenNights.Result early = ScreenNights.measure(List.of(ev("2026-11-15T16:00:00Z", 11, "android")), NONE,
            Map.of("2026-11-16", Instant.parse("2026-11-15T17:00:00Z")), Instant.parse("2026-11-15T16:00:00Z"), INDIA,
            Instant.parse("2026-11-16T04:30:00Z"));
        assertTrue(early.skipped.contains("2026-11-16: before_records"));
    }

    @Test
    public void aNightWithoutABreakFromThePhoneHasNoBed() {
        // Used every two hours all night: no three-hour break, so no bed and no number.
        List<ScreenNights.Event> events = new ArrayList<>();
        events.add(ev("2026-11-14T08:00:00Z", 11, "android"));
        for (int h = 0; h < 20; h += 2) {
            Instant at = Instant.parse("2026-11-14T12:00:00Z").plusSeconds(h * 3600L);
            events.add(new ScreenNights.Event(at, ScreenNights.RESUMED, "chat", "Main"));
            events.add(new ScreenNights.Event(at.plusSeconds(600), ScreenNights.PAUSED, "chat", "Main"));
        }
        ScreenNights.Result r = ScreenNights.measure(events, NONE, Map.of(), Instant.parse("2026-11-14T08:00:00Z"), INDIA,
            Instant.parse("2026-11-16T04:30:00Z"));
        assertTrue(r.skipped.toString(), r.skipped.contains("2026-11-15: no_night_break"));
    }

    @Test
    public void aBedtimeStillAheadIsNotMeasured() {
        ScreenNights.Result r = ScreenNights.measure(List.of(ev("2026-11-10T00:00:00Z", 11, "android")), NONE,
            // Read at 00:30 on the 16th; the log says bed at 01:00.
            Map.of("2026-11-16", Instant.parse("2026-11-15T19:30:00Z")), Instant.parse("2026-11-10T00:00:00Z"), INDIA,
            Instant.parse("2026-11-15T19:00:00Z"));
        assertTrue(r.skipped.contains("2026-11-16: in_progress"));
    }

    @Test
    public void theWindowIsThreeRealHoursAcrossAClockChange() {
        // UK clocks went back at 02:00 BST on 25 Oct 2026. Bed at 02:30 GMT: the window
        // runs from 00:30 BST, four hours on the clock and three in fact.
        ZoneId london = ZoneId.of("Europe/London");
        List<ScreenNights.Event> events = List.of(
            ev("2026-10-24T10:00:00Z", 11, "android"),
            ev("2026-10-24T22:00:00Z", ScreenNights.RESUMED, "video"),
            ev("2026-10-25T02:30:00Z", ScreenNights.SCREEN_OFF, "android"),
            ev("2026-10-25T08:00:00Z", ScreenNights.RESUMED, "chat"),
            ev("2026-10-25T08:05:00Z", ScreenNights.PAUSED, "chat"));
        ScreenNights.Result r = ScreenNights.measure(events, NONE, Map.of(), Instant.parse("2026-10-24T10:00:00Z"), london,
            Instant.parse("2026-10-25T15:00:00Z"));
        ScreenNights.Night n = night(r, "2026-10-25");
        assertEquals(Instant.parse("2026-10-25T02:30:00Z"), n.bedtime);
        assertEquals(180, n.minutes);
    }

    @Test
    public void bedtimesFromThePageThatArentDatesAndTimesAreLeftOut() throws Exception {
        Map<String, Instant> b = ScreenNights.bedtimesFrom(new JSONObject()
            .put("2026-11-15", "2026-11-14T16:30:00Z").put("yesterday", "2026-11-14T16:30:00Z").put("2026-11-16", "late"));
        assertEquals(Map.of("2026-11-15", Instant.parse("2026-11-14T16:30:00Z")), b);
        assertTrue(ScreenNights.bedtimesFrom(null).isEmpty());
    }

    @Test
    public void thePhoneSendsExactlyWhatTheServersTestsUse() throws Exception {
        String path = "../../tests/fixtures/screen-time/week-nights.json";
        JSONObject expected = new JSONObject(new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)), StandardCharsets.UTF_8));
        JSONObject actual = ScreenNights.toJson(week(null));
        assertTrue("the phone sent " + actual.toString(2), sameJson(expected, actual));
        assertEquals(List.of("2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"),
            week(null).nights.stream().map(n -> n.date).collect(Collectors.toList()));
    }
}
