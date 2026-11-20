package app.somniai.alarm.alarms;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import app.somniai.alarm.MainActivity;
import java.text.DateFormat;
import java.util.Date;

/**
 * The fallback when Android refuses to start the ring service: a
 * high-priority notification in the alarm category, which says plainly that
 * the alarm could not ring.
 */
final class AlarmNotifier {

    static final String CHANNEL = "alarms";
    static final String REPORTS = "reports";

    private AlarmNotifier() {}

    /** Returns whether it was shown; the user may have turned notifications off. */
    static boolean show(Context context, AlarmSpec spec, long scheduledFor) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) {
            Log.w(AlarmScheduler.TAG, "fired " + spec.id + " but notifications are off, so nothing was shown");
            return false;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alarms going off");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);

        PendingIntent open = PendingIntent.getActivity(context, 0,
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(scheduledFor));
        String title = spec.label.isEmpty() ? "Alarm, " + time : spec.label + ", " + time;
        try {
            manager.notify(spec.id, 0, new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText("Your alarm went off, but Android didn't let SomniAI ring it.")
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build());
            return true;
        }
        catch (SecurityException e) {
            // POST_NOTIFICATIONS revoked between the check and the post.
            Log.w(AlarmScheduler.TAG, "could not show the alarm notification: " + e.getMessage());
            return false;
        }
    }

    /**
     * The morning report (prompt 3.4), quietly: the alarm is already over.
     * One per alarm, so a later ring's report replaces the earlier one.
     */
    static void showReport(Context context, MorningNotice notice) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) {
            Log.w(AlarmScheduler.TAG, "morning report for " + notice.alarmId + " not shown: notifications are off");
            return;
        }
        NotificationChannel channel = new NotificationChannel(REPORTS, "Morning reports", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("After each alarm: what woke you, the wake check, last night's plan and your streak");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        PendingIntent open = PendingIntent.getActivity(context, 0,
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            manager.notify("report-" + notice.alarmId, 0, new NotificationCompat.Builder(context, REPORTS)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(notice.title)
                .setContentText(notice.summary)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(notice.text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build());
            Log.i(AlarmScheduler.TAG, "morning report shown for " + notice.alarmId + ": " + notice.summary);
        }
        catch (SecurityException e) {
            Log.w(AlarmScheduler.TAG, "could not show the morning report: " + e.getMessage());
        }
    }
}
