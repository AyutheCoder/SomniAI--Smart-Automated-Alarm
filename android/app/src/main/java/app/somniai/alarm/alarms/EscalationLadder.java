package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The five-stage escalation ladder (lib/escalation.ts), climbed on the phone
 * from the ring plan cached with the alarm, so it works offline. Pure; tested
 * in EscalationLadderTest against a table written by the TypeScript.
 *
 * Where it comes from:
 * <ul>
 *   <li>The plan's own ladder: personalised by the server to how this person
 *       wakes (sooner for a hard waker, backups held back for an easy one).</li>
 *   <li>The standard ladder for the plan's strategy, if the plan has none or
 *       it doesn't make sense (no level at 0 s, out of order, unknown fields).</li>
 *   <li>For an unmissable (critical) alarm, always the full ladder: every
 *       level, every backup, and never later than the standard timing,
 *       whatever the personal plan holds back. The web's own critical ladder
 *       can climb slower than standard for an easy waker; the phone doesn't.</li>
 * </ul>
 */
final class EscalationLadder {

    static final List<String> BACKUP_KINDS = Collections.unmodifiableList(Arrays.asList("secondaryAlarm", "smartwatch", "emergencyContact"));

    static final class Level {
        final int level;
        final int afterSeconds;
        final String label;
        final double volumeFactor;
        final boolean vibrate;
        final boolean requireVerification;
        final List<String> backup;
        final String stage;

        Level(int level, int afterSeconds, String label, double volumeFactor, boolean vibrate, boolean requireVerification, List<String> backup, String stage) {
            this.level = level;
            this.afterSeconds = afterSeconds;
            this.label = label;
            this.volumeFactor = volumeFactor;
            this.vibrate = vibrate;
            this.requireVerification = requireVerification;
            this.backup = Collections.unmodifiableList(new ArrayList<>(backup));
            this.stage = stage;
        }
    }

    final List<Level> levels;
    final boolean critical;
    /** Where the ladder came from, for the ring log: "plan", "standard (...)", plus "full ladder (unmissable)". */
    final String source;

    private EscalationLadder(List<Level> levels, boolean critical, String source) {
        this.levels = Collections.unmodifiableList(levels);
        this.critical = critical;
        this.source = source;
    }

    /** The standard ladder, as buildEscalationPlan in lib/escalation.ts. */
    static List<Level> standard(String strategy) {
        int[] t;
        switch (strategy) {
            case "gentle":
                t = new int[] { 20, 40, 60, 120 };
                break;
            case "aggressive":
                t = new int[] { 5, 10, 18, 40 };
                break;
            default:
                t = new int[] { 10, 22, 35, 75 };
        }
        List<String> none = Collections.emptyList();
        return Arrays.asList(
            new Level(1, 0, "Normal alarm", 1, false, false, none, "ramp"),
            new Level(2, t[0], "Increased volume", 1.4, false, false, none, "ramp"),
            new Level(3, t[1], "Continuous vibration", 1.5, true, false, none, "vibration"),
            new Level(4, t[2], "Wake challenge", 1.6, true, true, none, "challenge"),
            new Level(5, t[3], "Trying backups", 1.8, true, true, BACKUP_KINDS, "challenge"));
    }

    static EscalationLadder fromRingPlan(String ringPlanJson) {
        String strategy = "adaptive";
        boolean critical = false;
        List<Level> levels = null;
        String why = "no ring plan";
        if (ringPlanJson != null) {
            try {
                JSONObject plan = new JSONObject(ringPlanJson);
                JSONObject sound = plan.optJSONObject("sound");
                if (sound != null) {
                    strategy = sound.optString("strategy", "adaptive");
                }
                critical = plan.optBoolean("critical", false);
                JSONArray esc = plan.optJSONArray("escalation");
                levels = esc == null ? null : parse(esc);
                why = esc == null ? "no ladder in the plan" : levels == null ? "the plan's ladder doesn't make sense" : null;
            }
            catch (JSONException e) {
                why = "unreadable ring plan";
            }
        }
        List<Level> standard = standard(strategy);
        String source = levels != null ? "plan" : "standard " + strategy + " (" + why + ")";
        List<Level> chosen = levels != null ? levels : standard;
        if (critical) {
            return new EscalationLadder(full(chosen, standard), true, source + ", full ladder (unmissable)");
        }
        return new EscalationLadder(chosen, false, source);
    }

    /**
     * Every standard level, each at least as strong as both ladders make it,
     * and no later than either.
     */
    static List<Level> full(List<Level> personal, List<Level> standard) {
        List<Level> out = new ArrayList<>();
        for (Level s : standard) {
            Level p = null;
            for (Level l : personal) {
                if (l.level == s.level) {
                    p = l;
                }
            }
            if (p == null) {
                out.add(s);
                continue;
            }
            Set<String> backups = new LinkedHashSet<>();
            for (String kind : BACKUP_KINDS) {
                if (s.backup.contains(kind) || p.backup.contains(kind)) {
                    backups.add(kind);
                }
            }
            out.add(new Level(s.level, Math.min(s.afterSeconds, p.afterSeconds), s.label,
                Math.max(s.volumeFactor, p.volumeFactor), s.vibrate || p.vibrate,
                s.requireVerification || p.requireVerification, new ArrayList<>(backups), s.stage));
        }
        return out;
    }

    /** The plan's levels, or null if they don't make a ladder that can be climbed. */
    private static List<Level> parse(JSONArray esc) {
        List<Level> out = new ArrayList<>();
        try {
            for (int i = 0; i < esc.length(); i++) {
                JSONObject o = esc.getJSONObject(i);
                Object level = o.opt("level");
                Object after = o.opt("afterSeconds");
                Object factor = o.opt("volumeFactor");
                if (!(level instanceof Integer) || (Integer) level < 1 || (Integer) level > 5
                        || !(after instanceof Number) || ((Number) after).doubleValue() < 0
                        || !(factor instanceof Number) || ((Number) factor).doubleValue() <= 0
                        || !(o.opt("vibrate") instanceof Boolean) || !(o.opt("requireVerification") instanceof Boolean)) {
                    return null;
                }
                List<String> backup = new ArrayList<>();
                JSONArray b = o.optJSONArray("backup");
                if (b != null) {
                    for (int k = 0; k < b.length(); k++) {
                        String kind = b.getString(k);
                        if (!BACKUP_KINDS.contains(kind)) {
                            return null;
                        }
                        backup.add(kind);
                    }
                }
                out.add(new Level((Integer) level, (int) Math.round(((Number) after).doubleValue()), o.optString("label", "Level " + level),
                    ((Number) factor).doubleValue(), o.getBoolean("vibrate"), o.getBoolean("requireVerification"), backup, o.optString("stage", "ramp")));
            }
        }
        catch (JSONException e) {
            return null;
        }
        if (out.isEmpty() || out.get(0).afterSeconds != 0) {
            return null;
        }
        for (int i = 1; i < out.size(); i++) {
            if (out.get(i).level <= out.get(i - 1).level || out.get(i).afterSeconds < out.get(i - 1).afterSeconds) {
                return null;
            }
        }
        return out;
    }

    /** The level in force {@code elapsedMs} into the ring, as levelForElapsed. */
    Level at(long elapsedMs) {
        Level active = levels.get(0);
        for (Level l : levels) {
            if (elapsedMs >= l.afterSeconds * 1000L) {
                active = l;
            }
        }
        return active;
    }

    Level top() {
        return levels.get(levels.size() - 1);
    }
}
