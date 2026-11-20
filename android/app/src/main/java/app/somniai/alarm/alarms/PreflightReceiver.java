package app.somniai.alarm.alarms;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import java.text.DateFormat;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Runs the bedtime check before the next alarm ({@link PreflightSchedule}
 * says when) and, if anything needs fixing, posts one notification that opens
 * {@link PreflightActivity}. Nothing is posted when everything passes.
 *
 * {@link #update} is called whenever the alarms change; it never throws, so
 * the check can't get in the way of setting an alarm.
 */
public class PreflightReceiver extends BroadcastReceiver {

    static final String CHANNEL = "bedtime_check";
    static final int NOTIFICATION_ID = 7002;
    private static final String EXTRA_ALARM_AT = "app.somniai.alarm.PREFLIGHT_ALARM_AT";

    @Override
    public void onReceive(Context context, Intent intent) {
        long alarmAt = intent.getLongExtra(EXTRA_ALARM_AT, 0);
        Long next = nextAlarmAt(context);
        if (next == null || next != alarmAt) {
            // The alarms changed since this was set; the next one gets its own check.
            update(context);
            return;
        }
        List<Preflight.Check> checks = Preflight.run(PreflightProbe.read(context));
        PreflightProbe.setCheckedFor(context, alarmAt);
        int attention = Preflight.attention(checks);
        Log.i(AlarmScheduler.TAG, "bedtime check for the alarm at " + Instant.ofEpochMilli(alarmAt) + ": " + summary(checks));
        if (attention > 0) {
            notify(context, checks, attention, alarmAt);
        }
        update(context);
    }

    /** Sets, moves or cancels the check for the next alarm. Never throws. */
    static void update(Context context) {
        try {
            long now = System.currentTimeMillis();
            PreflightSchedule.Plan plan = PreflightSchedule.next(nextAlarmAt(context), PreflightProbe.bedtime(context),
                PreflightProbe.checkedFor(context), now);
            AlarmManager am = context.getSystemService(AlarmManager.class);
            PendingIntent existing = pending(context, 0, PendingIntent.FLAG_NO_CREATE);
            if (plan == null) {
                if (existing != null) {
                    am.cancel(existing);
                    existing.cancel();
                }
                return;
            }
            PendingIntent pi = pending(context, plan.alarmAt, PendingIntent.FLAG_UPDATE_CURRENT);
            // Not an alarm clock: it shouldn't show as the next alarm. Exact while
            // idle where allowed, so it comes before bed rather than after.
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.checkAt, pi);
            }
            else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.checkAt, pi);
            }
            Log.i(AlarmScheduler.TAG, "bedtime check set for " + Instant.ofEpochMilli(plan.checkAt) + ", before the alarm at "
                + Instant.ofEpochMilli(plan.alarmAt) + (plan.planned ? " (planned bedtime)" : " (8 hours before)"));
        }
        catch (RuntimeException e) {
            Log.w(AlarmScheduler.TAG, "bedtime check not set: " + e);
        }
    }

    /** The earliest scheduled alarm, or null. */
    static Long nextAlarmAt(Context context) {
        Long next = null;
        for (AlarmRecord r : AlarmScheduler.list(context)) {
            if (r.status == AlarmRecord.Status.SCHEDULED && r.triggerAt != null && (next == null || r.triggerAt < next)) {
                next = r.triggerAt;
            }
        }
        return next;
    }

    private static PendingIntent pending(Context context, long alarmAt, int flags) {
        Intent intent = new Intent(context, PreflightReceiver.class).putExtra(EXTRA_ALARM_AT, alarmAt);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void notify(Context context, List<Preflight.Check> checks, int attention, long alarmAt) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Bedtime check", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Before bed, if a setting could stop tomorrow's alarm.");
        nm.createNotificationChannel(channel);
        List<String> titles = new ArrayList<>();
        for (Preflight.Check c : checks) {
            if (c.needsAttention()) {
                titles.add(c.title);
            }
        }
        String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(alarmAt));
        PendingIntent open = PendingIntent.getActivity(context, 0,
            new Intent(context, PreflightActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Before bed: " + (attention == 1 ? "1 thing" : attention + " things") + " could stop your " + time + " alarm")
            .setContentText(String.join(", ", titles) + ". Tap to check.")
            .setStyle(new Notification.BigTextStyle().bigText(String.join(", ", titles) + ". Tap to check and fix."))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .build();
        nm.notify(NOTIFICATION_ID, n);
        Log.i(AlarmScheduler.TAG, "bedtime check: notified, " + attention + " to fix: " + titles);
    }

    static String summary(List<Preflight.Check> checks) {
        StringBuilder sb = new StringBuilder();
        for (Preflight.Check c : checks) {
            sb.append(sb.length() == 0 ? "" : ", ").append(c.id).append(' ').append(c.status.name().toLowerCase());
        }
        return sb.toString();
    }
}
