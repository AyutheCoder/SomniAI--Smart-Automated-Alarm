package app.somniai.alarm.alarms;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import app.somniai.alarm.MainActivity;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Hands alarms to AlarmManager.setAlarmClock: exact, shown to the user as the
 * next alarm, and delivered through Doze ("Alarms set with setAlarmClock()
 * continue to fire normally", Android's Doze documentation).
 *
 * The decisions live in {@link AlarmPlanner} and {@link NextTrigger}, which
 * are tested on the JVM; this class applies them.
 */
public final class AlarmScheduler {

    public static final String TAG = "SomniAlarm";
    static final String EXTRA_ID = "app.somniai.alarm.ID";
    static final String EXTRA_AT = "app.somniai.alarm.AT";

    private AlarmScheduler() {}

    public static ExactAlarmAccess.State access(Context context) {
        int sdk = Build.VERSION.SDK_INT;
        if (sdk < ExactAlarmAccess.S) {
            return ExactAlarmAccess.decide(sdk, true);
        }
        return ExactAlarmAccess.decide(sdk, alarmManager(context).canScheduleExactAlarms());
    }

    /**
     * Saves a new or edited alarm and schedules it. A one-off whose time has
     * already passed is refused, not saved.
     */
    public static AlarmRecord put(Context context, AlarmSpec spec) {
        Instant now = Instant.now();
        ZoneId zone = ZoneId.systemDefault();
        if (spec.enabled && spec.isOneOff() && NextTrigger.after(spec, now, zone) == null) {
            throw new IllegalArgumentException("that date and time have already passed");
        }
        synchronized (AlarmStore.LOCK) {
            AlarmRecord existing = AlarmStore.get(context, spec.id);
            // A fresh start for the edited alarm: its old trigger is not a missed occurrence.
            AlarmRecord start = new AlarmRecord(spec, AlarmRecord.Status.DISABLED, null, existing == null ? null : existing.lastFiredAt);
            AlarmRecord record = apply(context, AlarmPlanner.plan(start, now, zone, canSchedule(context)).record);
            AlarmStore.put(context, record);
            return record;
        }
    }

    public static boolean remove(Context context, String id) {
        synchronized (AlarmStore.LOCK) {
            cancel(context, id);
            return AlarmStore.remove(context, id);
        }
    }

    public static List<AlarmRecord> list(Context context) {
        synchronized (AlarmStore.LOCK) {
            return AlarmStore.all(context);
        }
    }

    /** Schedules every stored alarm again. Idempotent: the same alarm gets the same PendingIntent. */
    public static List<AlarmRecord> rescheduleAll(Context context, String reason, ZoneId zone) {
        Instant now = Instant.now();
        boolean allowed = canSchedule(context);
        List<AlarmRecord> out = new ArrayList<>();
        synchronized (AlarmStore.LOCK) {
            for (AlarmRecord current : AlarmStore.all(context)) {
                AlarmPlanner.Planned planned = AlarmPlanner.plan(current, now, zone, allowed);
                AlarmRecord record = apply(context, planned.record);
                AlarmStore.put(context, record);
                if (planned.missed != null) {
                    AlarmStore.log(context, logEntry(record.spec, "missed", planned.missed, null, reason));
                }
                out.add(record);
            }
        }
        Log.i(TAG, "rescheduled " + out.size() + " alarm(s) after " + reason + " in " + zone + ": " + summary(out));
        return out;
    }

    /**
     * An alarm was delivered: show it, move it on, and record what happened.
     * Returns the record it fired for, or null if the delivery was stale.
     */
    static AlarmRecord onFired(Context context, String id, long scheduledFor) {
        Instant now = Instant.now();
        synchronized (AlarmStore.LOCK) {
            AlarmRecord current = id == null ? null : AlarmStore.get(context, id);
            if (!AlarmPlanner.shouldRing(current, scheduledFor)) {
                Log.w(TAG, "dropped a stale delivery for " + id + " scheduled for " + Instant.ofEpochMilli(scheduledFor));
                return null;
            }
            AlarmRecord next = apply(context, AlarmPlanner.afterFiring(current, now, ZoneId.systemDefault(), canSchedule(context)));
            AlarmStore.put(context, next);
            boolean shown = AlarmNotifier.show(context, current.spec, scheduledFor);
            AlarmStore.log(context, logEntry(current.spec, shown ? "fired" : "fired_not_shown", scheduledFor, now.toEpochMilli(), null));
            Log.i(TAG, "fired " + id + " scheduled for " + Instant.ofEpochMilli(scheduledFor)
                + ", " + (now.toEpochMilli() - scheduledFor) + " ms late, notification " + (shown ? "shown" : "NOT shown")
                + "; next " + describe(next));
            return current;
        }
    }

    private static boolean canSchedule(Context context) {
        return ExactAlarmAccess.canSchedule(access(context));
    }

    /** Makes AlarmManager match the record. A refusal from Android is recorded, not hidden. */
    private static AlarmRecord apply(Context context, AlarmRecord record) {
        if (record.status != AlarmRecord.Status.SCHEDULED || record.triggerAt == null) {
            cancel(context, record.spec.id);
            return record;
        }
        try {
            AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(record.triggerAt, showIntent(context));
            alarmManager(context).setAlarmClock(info, fireIntent(context, record.spec.id, record.triggerAt, PendingIntent.FLAG_UPDATE_CURRENT));
            return record;
        }
        catch (SecurityException e) {
            Log.w(TAG, "exact alarms refused for " + record.spec.id + ": " + e.getMessage());
            return new AlarmRecord(record.spec, AlarmRecord.Status.WAITING_FOR_PERMISSION, null, record.lastFiredAt);
        }
    }

    private static void cancel(Context context, String id) {
        PendingIntent pending = fireIntent(context, id, 0, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            alarmManager(context).cancel(pending);
            pending.cancel();
        }
    }

    /**
     * One PendingIntent per alarm, told apart by its data URI, so setting an
     * alarm again replaces it rather than adding a second.
     */
    private static PendingIntent fireIntent(Context context, String id, long at, int flags) {
        Intent intent = new Intent(context, AlarmFiredReceiver.class)
            .setData(new Uri.Builder().scheme("somniai-alarm").authority("alarm").appendPath(id).build())
            .putExtra(EXTRA_ID, id)
            .putExtra(EXTRA_AT, at);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** What the system opens when the user taps the next-alarm indicator. */
    private static PendingIntent showIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static AlarmManager alarmManager(Context context) {
        return (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    }

    static JSONObject logEntry(AlarmSpec spec, String outcome, long scheduledFor, Long firedAt, String reason) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", spec.id);
            o.put("label", spec.label);
            o.put("outcome", outcome);
            o.put("scheduledFor", scheduledFor);
            o.put("firedAt", firedAt == null ? JSONObject.NULL : firedAt);
            o.put("reason", reason == null ? JSONObject.NULL : reason);
            return o;
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String describe(AlarmRecord r) {
        return r.status == AlarmRecord.Status.SCHEDULED ? Instant.ofEpochMilli(r.triggerAt).toString() : r.status.name();
    }

    private static String summary(List<AlarmRecord> records) {
        StringBuilder sb = new StringBuilder("[");
        for (AlarmRecord r : records) {
            sb.append(sb.length() > 1 ? ", " : "").append(r.spec.id).append(" -> ").append(describe(r));
        }
        return sb.append("]").toString();
    }
}
