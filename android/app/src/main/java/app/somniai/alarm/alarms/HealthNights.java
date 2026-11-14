package app.somniai.alarm.alarms;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Health Connect's sleep sessions and resting heart rate, as nights
 * (prompt 4.2). Pure; tested in HealthNightsTest on fixtures.
 *
 * The rules are the paper's (ai-brain/datasets/pmdata.py): a night is keyed by
 * the date it ended, the wake date, and when one night holds several sessions
 * (a split night, an afternoon nap, two apps recording the same sleep) the
 * longest by time asleep is kept. Time asleep is the sleep stages where the
 * app recorded them, otherwise the session's length. Resting heart rate is
 * matched by date, the median of that day's readings.
 *
 * A session still being recorded isn't a night yet: it's left out and read
 * again next time, as is a night a watch hasn't finished syncing (each read
 * covers the last two weeks again, so a later, longer session replaces it).
 */
final class HealthNights {

    // Health Connect's SleepSessionRecord stage types.
    static final int STAGE_UNKNOWN = 0;
    static final int STAGE_AWAKE = 1;
    static final int STAGE_SLEEPING = 2;
    static final int STAGE_OUT_OF_BED = 3;
    static final int STAGE_LIGHT = 4;
    static final int STAGE_DEEP = 5;
    static final int STAGE_REM = 6;
    static final int STAGE_AWAKE_IN_BED = 7;

    static final class Stage {
        final Instant start;
        final Instant end;
        final int type;

        Stage(Instant start, Instant end, int type) {
            this.start = start;
            this.end = end;
            this.type = type;
        }

        boolean asleep() {
            return type == STAGE_SLEEPING || type == STAGE_LIGHT || type == STAGE_DEEP || type == STAGE_REM;
        }
    }

    static final class Session {
        final String id;
        final Instant start;
        final Instant end;
        /** The app that wrote it, such as a watch's companion app. */
        final String origin;
        final List<Stage> stages;

        Session(String id, Instant start, Instant end, String origin, List<Stage> stages) {
            this.id = id;
            this.start = start;
            this.end = end;
            this.origin = origin;
            this.stages = stages;
        }

        long inBedMinutes() {
            return Math.max(0, (end.toEpochMilli() - start.toEpochMilli()) / 60_000);
        }

        boolean hasStages() {
            return !stages.isEmpty();
        }

        long asleepMinutes() {
            if (!hasStages()) {
                return inBedMinutes();
            }
            long ms = 0;
            for (Stage s : stages) {
                if (s.asleep()) {
                    ms += Math.max(0, s.end.toEpochMilli() - s.start.toEpochMilli());
                }
            }
            return ms / 60_000;
        }
    }

    static final class HeartRate {
        final Instant time;
        final long bpm;

        HeartRate(Instant time, long bpm) {
            this.time = time;
            this.bpm = bpm;
        }
    }

    static final class Night {
        /** The wake date, yyyy-mm-dd in the phone's zone. */
        final String date;
        final Session session;
        /** How many sessions ended on this date; the longest was kept. */
        final int sessions;
        /** Median resting heart rate on the wake date, or null if none was recorded. */
        final Long restingHr;

        Night(String date, Session session, int sessions, Long restingHr) {
            this.date = date;
            this.session = session;
            this.sessions = sessions;
            this.restingHr = restingHr;
        }
    }

    static final class Result {
        final List<Night> nights = new ArrayList<>();
        /** Sessions not made into nights yet, and why: "in_progress". */
        final List<String> skipped = new ArrayList<>();
    }

    private HealthNights() {}

    static Result fold(List<Session> sessions, List<HeartRate> heart, ZoneId zone, Instant now) {
        Result r = new Result();
        Map<String, List<Session>> byDate = new TreeMap<>();
        for (Session s : sessions) {
            if (s.end.isAfter(now)) {
                r.skipped.add(s.id + ": in_progress");
                continue;
            }
            if (!s.end.isAfter(s.start)) {
                continue;
            }
            byDate.computeIfAbsent(s.end.atZone(zone).toLocalDate().toString(), d -> new ArrayList<>()).add(s);
        }
        Map<String, List<Long>> hrByDate = new LinkedHashMap<>();
        for (HeartRate h : heart) {
            if (h.bpm > 0) {
                hrByDate.computeIfAbsent(h.time.atZone(zone).toLocalDate().toString(), d -> new ArrayList<>()).add(h.bpm);
            }
        }
        for (Map.Entry<String, List<Session>> e : byDate.entrySet()) {
            List<Session> night = e.getValue();
            // Longest asleep; on a tie the longer in bed, then the earlier id, so it's stable.
            Session kept = Collections.max(night, Comparator
                .comparingLong(Session::asleepMinutes)
                .thenComparingLong(Session::inBedMinutes)
                .thenComparing((Session s) -> s.id, Comparator.reverseOrder()));
            r.nights.add(new Night(e.getKey(), kept, night.size(), median(hrByDate.get(e.getKey()))));
        }
        return r;
    }

    private static Long median(List<Long> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        List<Long> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int n = sorted.size();
        return n % 2 == 1 ? sorted.get(n / 2) : Math.round((sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0);
    }

    /** The nights as the server's import takes them (POST /api/sleep-logs/import). */
    static JSONObject toJson(Result r) {
        try {
            JSONArray nights = new JSONArray();
            for (Night n : r.nights) {
                JSONObject o = new JSONObject()
                    .put("date", n.date)
                    .put("sleepTime", n.session.start.toString())
                    .put("wakeTime", n.session.end.toString())
                    .put("asleepMinutes", n.session.asleepMinutes())
                    .put("inBedMinutes", n.session.inBedMinutes())
                    .put("stagesRecorded", n.session.hasStages())
                    .put("sessions", n.sessions)
                    .put("sessionId", n.session.id)
                    .put("origin", n.session.origin);
                if (n.restingHr != null) {
                    o.put("restingHr", n.restingHr);
                }
                nights.put(o);
            }
            return new JSONObject().put("nights", nights).put("skipped", new JSONArray(r.skipped));
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Sessions and readings from the fixtures' JSON shape (and HealthConnect's mapping of the SDK records). */
    static List<Session> sessionsFrom(JSONArray a) throws JSONException {
        List<Session> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.getJSONObject(i);
            List<Stage> stages = new ArrayList<>();
            JSONArray st = o.optJSONArray("stages");
            if (st != null) {
                for (int j = 0; j < st.length(); j++) {
                    JSONObject s = st.getJSONObject(j);
                    stages.add(new Stage(Instant.parse(s.getString("start")), Instant.parse(s.getString("end")), s.getInt("stage")));
                }
            }
            out.add(new Session(o.getString("id"), Instant.parse(o.getString("start")), Instant.parse(o.getString("end")),
                o.optString("origin", ""), stages));
        }
        return out;
    }

    static List<HeartRate> heartFrom(JSONArray a) throws JSONException {
        List<HeartRate> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.getJSONObject(i);
            out.add(new HeartRate(Instant.parse(o.getString("time")), o.getLong("bpm")));
        }
        return out;
    }
}
