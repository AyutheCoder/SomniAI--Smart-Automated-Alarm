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
 * The visible sign that an alarm fired, until prompt 2.3 makes it ring: a
 * high-priority notification in the alarm category. It says plainly that it
 * is not the ringing alarm yet.
 */
final class AlarmNotifier {

    static final String CHANNEL = "alarms";

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
                .setContentText("Your alarm went off. Ringing and the wake check come in a later update.")
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
}
