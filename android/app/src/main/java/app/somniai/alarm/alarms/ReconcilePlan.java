package app.somniai.alarm.alarms;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * What it takes to make the phone's schedule match the server's list of
 * alarms. Pure; tested in ReconcilePlanTest. ANDROID.md, "Keeping the phone
 * and the server in step", has the rules in words:
 * <ul>
 *   <li>The server owns the definitions: an alarm on the server and not here
 *       is added, one here and not on the server is removed, and where they
 *       differ the server's wins.</li>
 *   <li>The phone owns what already rang: a one-off that rang (or was missed)
 *       here is not armed again because the server hasn't heard yet.</li>
 *   <li>A one-off whose time has passed, which this phone never had, is not
 *       scheduled: the past can't ring.</li>
 *   <li>Alarms the server didn't make (the debug hook's) are left alone.</li>
 *   <li>Unchanged alarms are not touched, so reconciling twice is the same as
 *       once.</li>
 * </ul>
 */
final class ReconcilePlan {

    /** The server's alarm ids are MongoDB ObjectIds. */
    private static final Pattern SERVER_ID = Pattern.compile("[0-9a-f]{24}");

    final List<AlarmSpec> put = new ArrayList<>();
    final List<String> remove = new ArrayList<>();
    final List<String> unchanged = new ArrayList<>();
    /** One-offs that already rang or were missed here; the server will hear through the outbox. */
    final List<String> keptHistory = new ArrayList<>();
    /** One-offs whose time passed before this phone ever had them. */
    final List<String> past = new ArrayList<>();

    static boolean isServerAlarm(String id) {
        return SERVER_ID.matcher(id).matches();
    }

    /**
     * @param desired the server's full list. A partial list would remove the
     *     rest, so the web app only sends one it loaded successfully.
     * @throws IllegalArgumentException for an id that isn't the server's, or
     *     one listed twice: a list like that is a bug to surface, not guess at.
     */
    static ReconcilePlan diff(Collection<AlarmRecord> current, List<AlarmSpec> desired, Instant now, ZoneId zone) {
        Set<String> seen = new HashSet<>();
        for (AlarmSpec d : desired) {
            if (!isServerAlarm(d.id)) {
                throw new IllegalArgumentException("not a server alarm id: " + d.id);
            }
            if (!seen.add(d.id)) {
                throw new IllegalArgumentException("alarm listed twice: " + d.id);
            }
        }
        Map<String, AlarmRecord> here = new HashMap<>();
        for (AlarmRecord r : current) {
            here.put(r.spec.id, r);
        }

        ReconcilePlan plan = new ReconcilePlan();
        for (String id : here.keySet()) {
            if (isServerAlarm(id) && !seen.contains(id)) {
                plan.remove.add(id);
            }
        }
        java.util.Collections.sort(plan.remove);

        for (AlarmSpec d : desired) {
            AlarmRecord cur = here.get(d.id);
            if (cur != null && cur.spec.sameDefinition(d)) {
                plan.unchanged.add(d.id);
            }
            else if (cur != null && rangHere(cur) && d.isOneOff() && cur.spec.withEnabled(d.enabled).sameDefinition(d)) {
                // Only "enabled" differs: ringing turned it off here before the server knew.
                plan.keptHistory.add(d.id);
            }
            else if (d.enabled && d.isOneOff() && NextTrigger.after(d, now, zone) == null) {
                plan.past.add(d.id);
                if (cur != null) {
                    // Its old time, if any, must not ring.
                    plan.remove.add(d.id);
                }
            }
            else {
                plan.put.add(d);
            }
        }
        return plan;
    }

    private static boolean rangHere(AlarmRecord r) {
        return r.status == AlarmRecord.Status.DONE || r.status == AlarmRecord.Status.MISSED;
    }

    boolean isEmpty() {
        return put.isEmpty() && remove.isEmpty();
    }
}
