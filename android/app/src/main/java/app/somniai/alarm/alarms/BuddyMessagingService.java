package app.somniai.alarm.alarms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import app.somniai.alarm.MainActivity;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Receives wake-buddy alerts (prompt 3.2) and shows them, with a button that
 * opens the dialler on the sleeper's number when they shared one. The server
 * sends data messages, so this builds the notification itself, call button
 * and all, whether or not the app is open.
 */
public class BuddyMessagingService extends FirebaseMessagingService {

    static final String CHANNEL = "buddy_alerts";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        BuddyAlertMessage alert = BuddyAlertMessage.from(message.getData());
        if (alert == null) {
            Log.w(AlarmScheduler.TAG, "push ignored: not a buddy alert");
            return;
        }
        show(this, alert);
    }

    /** A new token: the web app sends it to the server the next time it opens (lib/nativeBuddy.ts). */
    @Override
    public void onNewToken(String token) {
        Log.i(AlarmScheduler.TAG, "push token changed; it is registered when SomniAI next opens");
    }

    static void show(Context context, BuddyAlertMessage alert) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Wake buddy", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("When your buddy hasn't confirmed they're awake after an alarm.");
        nm.createNotificationChannel(channel);

        PendingIntent open = PendingIntent.getActivity(context, alert.notificationId(),
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            .setStyle(new Notification.BigTextStyle().bigText(alert.phone == null
                ? alert.body + " They haven't shared a number to call."
                : alert.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE);
        if (alert.dialUri() != null) {
            // The dialler, not a call: no CALL_PHONE permission, and the user presses call.
            PendingIntent dial = PendingIntent.getActivity(context, alert.notificationId() + 1,
                new Intent(Intent.ACTION_DIAL, Uri.parse(alert.dialUri())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(new Notification.Action.Builder(null, "Call " + alert.name, dial).build());
        }
        b.addAction(new Notification.Action.Builder(null, "Open SomniAI", open).build());
        nm.notify(alert.notificationId(), b.build());
        Log.i(AlarmScheduler.TAG, "buddy alert shown about " + alert.name + (alert.phone == null ? " (no number)" : " (call button)"));
    }
}
