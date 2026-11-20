package app.somniai.alarm.alarms;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Screen time in the hours before bed (prompt 4.3), from Android's usage
 * events. Pure: UsageStatsManager is read by ScreenUsage, the windowing is
 * here, tested on fixtures (ScreenNightsTest).
 *
 * "Screen time" is what Digital Wellbeing counts: time an app was in the
 * foreground, all apps together (two at once in split screen count once), the
 * home screen, the system's own UI and the in-call screen left out. A night is keyed by its wake
 * date, as the sleep log is (4.2), and its value is the minutes of use in the
 * {@link #WINDOW_MINUTES} before bed: the model's screen_minutes_before_bed,
 * which runs from 0 to 180.
 *
 * Bed is the sleep log's bedtime for that date when the user has one (Health
 * Connect or typed in), else the phone's own reading of it: the end of the
 * last use before the night's longest break, a brief check of the phone in the
 * night not counting as getting up. A night that can't be told is skipped and
 * says why; it is never a 0.
 */
final class ScreenNights {

    /** The window before bed: the feature's range, 0 to 180 minutes. */
    static final int WINDOW_MINUTES = 180;
    /** Nights read, today's wake date included. */
    static final int DAYS = 7;

    // UsageEvents.Event types (the same numbers on every API level that has them).
    static final int RESUMED = 1;          // MOVE_TO_FOREGROUND, ACTIVITY_RESUMED from API 29
    static final int PAUSED = 2;           // MOVE_TO_BACKGROUND, ACTIVITY_PAUSED from API 29
    static final int SCREEN_OFF = 16;      // SCREEN_NON_INTERACTIVE, API 28+
    static final int STOPPED = 23;         // ACTIVITY_STOPPED, API 29+
    static final int SHUTDOWN = 26;        // DEVICE_SHUTDOWN, API 28+

    /** Where on the night the phone looks for bed: from 18:00 the day before to 14:00 on the wake date. */
    static final LocalTime SEARCH_FROM = LocalTime.of(18, 0);
    static final LocalTime SEARCH_TO = LocalTime.of(14, 0);
    /** Bed starts between 19:00 and 06:00. */
    static final LocalTime BED_EARLIEST = LocalTime.of(19, 0);
    static final LocalTime BED_LATEST = LocalTime.of(6, 0);
    /** A night's break is at least this long. */
    static final Duration MIN_NIGHT = Duration.ofHours(3);
    /** Uses closer than this are one session. */
    static final Duration SAME_SESSION = Duration.ofMinutes(15);
    /** A session this short, after an hour or more without the phone, is a check in the night. */
    static final Duration NIGHT_CHECK = Duration.ofMinutes(15);
    static final Duration NIGHT_CHECK_BEFORE = Duration.ofHours(1);

    static final class Event {
        final Instant at;
        final int type;
        final String pkg;
        final String cls;

        Event(Instant at, int type, String pkg, String cls) {
            this.at = at;
            this.type = type;
            this.pkg = pkg == null ? "" : pkg;
            this.cls = cls == null ? "" : cls;
        }
    }

    static final class Interval {
        final Instant start;
        final Instant end;

        Interval(Instant start, Instant end) {
            this.start = start;
            this.end = end;
        }

        Duration length() {
            return Duration.between(start, end);
        }
    }

    static final class Night {
        final String date;
        final Instant bedtime;
        final long minutes;
        /** "sleep_log" or "phone". */
        final String bedtimeFrom;

        Night(String date, Instant bedtime, long minutes, String bedtimeFrom) {
            this.date = date;
            this.bedtime = bedtime;
            this.minutes = minutes;
            this.bedtimeFrom = bedtimeFrom;
        }
    }

    static final class Result {
        final List<Night> nights;
        /** "2026-11-14: reason", for nights that couldn't be measured. */
        final List<String> skipped;

        Result(List<Night> nights, List<String> skipped) {
            this.nights = nights;
            this.skipped = skipped;
        }
    }

    private ScreenNights() {
    }

    /**
     * Time in use, merged: from an app coming to the foreground until it
     * leaves, the screen goes off or the phone shuts down. Apps in
     * {@code excluded} (the home screen, the system UI) don't count. One still
     * open at {@code end} is counted until then.
     */
    static List<Interval> inUse(List<Event> events, Set<String> excluded, Instant end) {
        List<Event> sorted = new ArrayList<>(events);
        sorted.sort(Comparator.comparing(e -> e.at));
        Map<String, Instant> open = new HashMap<>();
        List<Interval> raw = new ArrayList<>();
        for (Event e : sorted) {
            if (e.at.isAfter(end)) {
                break;
            }
            String key = e.pkg + "/" + e.cls;
            if (e.type == RESUMED) {
                if (!excluded.contains(e.pkg) && !inCall(e)) {
                    open.putIfAbsent(key, e.at);
                }
            }
            else if (e.type == PAUSED || e.type == STOPPED) {
                Instant from = open.remove(key);
                if (from != null) {
                    raw.add(new Interval(from, e.at));
                }
            }
            else if (e.type == SCREEN_OFF || e.type == SHUTDOWN) {
                for (Instant from : open.values()) {
                    raw.add(new Interval(from, e.at));
                }
                open.clear();
            }
        }
        for (Instant from : open.values()) {
            raw.add(new Interval(from, end));
        }
        return merge(raw, Duration.ZERO);
    }

    /**
     * The in-call screen: a call isn't screen time, and Digital Wellbeing
     * doesn't count it. Its activity stays resumed for the whole call while the
     * proximity sensor darkens the screen against the ear, with no screen-off
     * event, so counting it added every call's length (152 minutes in a day on
     * the test phone, 2026-11-14). AOSP and MIUI (com.android.incallui), Google's
     * Phone app (com.android.incallui.InCallActivity) and Samsung
     * (com.samsung.android.incallui) all name it so.
     */
    static boolean inCall(Event e) {
        return e.pkg.toLowerCase(java.util.Locale.ROOT).contains("incallui")
            || e.cls.toLowerCase(java.util.Locale.ROOT).contains("incallui");
    }

    /** Overlapping intervals, and ones less than {@code joinGap} apart, as one. */
    static List<Interval> merge(List<Interval> intervals, Duration joinGap) {
        List<Interval> sorted = new ArrayList<>();
        for (Interval i : intervals) {
            if (i.end.isAfter(i.start)) {
                sorted.add(i);
            }
        }
        sorted.sort(Comparator.comparing(i -> i.start));
        List<Interval> out = new ArrayList<>();
        for (Interval i : sorted) {
            Interval last = out.isEmpty() ? null : out.get(out.size() - 1);
            if (last != null && !i.start.isAfter(last.end.plus(joinGap))) {
                out.set(out.size() - 1, new Interval(last.start, i.end.isAfter(last.end) ? i.end : last.end));
            }
            else {
                out.add(i);
            }
        }
        return out;
    }

    /** Minutes of use from {@code from} up to {@code to}, rounded to the nearest minute. */
    static long minutesBetween(List<Interval> uses, Instant from, Instant to) {
        long seconds = 0;
        for (Interval i : uses) {
            Instant s = i.start.isBefore(from) ? from : i.start;
            Instant e = i.end.isAfter(to) ? to : i.end;
            if (e.isAfter(s)) {
                seconds += Duration.between(s, e).getSeconds();
            }
        }
        return Math.round(seconds / 60.0);
    }

    /** The phone's reading of bed on the night that ends on {@code wake}, or why it can't tell. */
    static Object bedtimeFromPhone(List<Interval> uses, LocalDate wake, ZoneId zone, Instant now) {
        Instant from = wake.minusDays(1).atTime(SEARCH_FROM).atZone(zone).toInstant();
        Instant searchTo = wake.atTime(SEARCH_TO).atZone(zone).toInstant();
        boolean complete = !now.isBefore(searchTo);
        Instant to = complete ? searchTo : now;
        List<Interval> inNight = new ArrayList<>();
        for (Interval i : uses) {
            Instant s = i.start.isBefore(from) ? from : i.start;
            Instant e = i.end.isAfter(to) ? to : i.end;
            if (e.isAfter(s)) {
                inNight.add(new Interval(s, e));
            }
        }
        if (inNight.isEmpty()) {
            return "no_use";
        }
        List<Interval> sessions = merge(inNight, SAME_SESSION);
        Instant bedEarliest = wake.minusDays(1).atTime(BED_EARLIEST).atZone(zone).toInstant();
        Instant bedLatest = wake.atTime(BED_LATEST).atZone(zone).toInstant();
        // The breaks after each session: to the next one, or after the last, to the end.
        int best = -1;
        Duration longest = Duration.ZERO;
        for (int k = 0; k < sessions.size(); k++) {
            Instant start = sessions.get(k).end;
            Instant end = k + 1 < sessions.size() ? sessions.get(k + 1).start : to;
            Duration gap = Duration.between(start, end);
            if (!start.isBefore(bedEarliest) && !start.isAfter(bedLatest) && gap.compareTo(longest) > 0) {
                longest = gap;
                best = k;
            }
        }
        if (best < 0 || longest.compareTo(MIN_NIGHT) < 0) {
            return "no_night_break";
        }
        Instant lastEnd = sessions.get(sessions.size() - 1).end;
        if (!complete && !lastEnd.isBefore(bedEarliest) && !lastEnd.isAfter(bedLatest)) {
            // The phone has been put down at an hour bed can start, and the
            // night isn't over: that break may yet be the night's.
            return "in_progress";
        }
        // A short look at the phone in the night, an hour or more after the
        // last use: bed was before it.
        int k = best;
        while (k > 0
            && sessions.get(k).length().compareTo(NIGHT_CHECK) <= 0
            && Duration.between(sessions.get(k - 1).end, sessions.get(k).start).compareTo(NIGHT_CHECK_BEFORE) >= 0
            && !sessions.get(k - 1).end.isBefore(bedEarliest)) {
            k--;
        }
        return sessions.get(k).end;
    }

    /**
     * The last {@link #DAYS} nights' screen time before bed. {@code bedtimes}
     * are the sleep log's, by wake date; {@code recordsFrom} is the earliest
     * time the phone's usage records cover (older ones are gone), and a night
     * whose window starts before it is skipped rather than undercounted.
     */
    static Result measure(List<Event> events, Set<String> excluded, Map<String, Instant> bedtimes,
                          Instant recordsFrom, ZoneId zone, Instant now) {
        List<Interval> uses = inUse(events, excluded, now);
        List<Night> nights = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        LocalDate today = now.atZone(zone).toLocalDate();
        for (int d = DAYS - 1; d >= 0; d--) {
            LocalDate wake = today.minusDays(d);
            String date = wake.toString();
            Instant bed = bedtimes.get(date);
            String bedFrom = "sleep_log";
            Instant searchFrom = wake.minusDays(1).atTime(SEARCH_FROM).atZone(zone).toInstant();
            if (recordsFrom == null || (bed == null && searchFrom.isBefore(recordsFrom))) {
                skipped.add(date + ": before_records");
                continue;
            }
            if (bed == null) {
                Object found = bedtimeFromPhone(uses, wake, zone, now);
                if (found instanceof String) {
                    skipped.add(date + ": " + found);
                    continue;
                }
                bed = (Instant) found;
                bedFrom = "phone";
            }
            else if (bed.isAfter(now)) {
                skipped.add(date + ": in_progress");
                continue;
            }
            Instant windowStart = bed.minus(Duration.ofMinutes(WINDOW_MINUTES));
            if (recordsFrom == null || windowStart.isBefore(recordsFrom)) {
                skipped.add(date + ": before_records");
                continue;
            }
            nights.add(new Night(date, bed, minutesBetween(uses, windowStart, bed), bedFrom));
        }
        return new Result(nights, skipped);
    }

    static JSONObject toJson(Result r) throws JSONException {
        JSONArray nights = new JSONArray();
        for (Night n : r.nights) {
            nights.put(new JSONObject()
                .put("date", n.date)
                .put("bedtime", n.bedtime.toString())
                .put("minutes", n.minutes)
                .put("windowMinutes", WINDOW_MINUTES)
                .put("bedtimeFrom", n.bedtimeFrom));
        }
        return new JSONObject().put("nights", nights).put("skipped", new JSONArray(r.skipped));
    }

    /** Events from a fixture: [{at, type, pkg, cls}]. */
    static List<Event> eventsFrom(JSONArray a) throws JSONException {
        List<Event> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.getJSONObject(i);
            out.add(new Event(Instant.parse(o.getString("at")), o.getInt("type"), o.optString("pkg", ""), o.optString("cls", "")));
        }
        return out;
    }

    /** Bedtimes from the page: {"2026-11-14": "2026-11-13T17:30:00Z"}; anything unreadable is left out. */
    static Map<String, Instant> bedtimesFrom(JSONObject o) {
        Map<String, Instant> out = new HashMap<>();
        if (o == null) {
            return out;
        }
        for (Iterator<String> keys = o.keys(); keys.hasNext(); ) {
            String k = keys.next();
            try {
                LocalDate.parse(k);
                out.put(k, Instant.parse(o.getString(k)));
            }
            catch (RuntimeException | JSONException ignored) {
                // Not a date and a time: the phone reads that night itself.
            }
        }
        return Collections.unmodifiableMap(out);
    }
}
