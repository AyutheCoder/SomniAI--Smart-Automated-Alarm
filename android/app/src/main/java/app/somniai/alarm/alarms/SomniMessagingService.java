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
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Every push SomniAI gets. The server sends data messages, so this decides
 * what each one does, whether or not the app is open:
 * <ul>
 *   <li>buddy_alert (3.2): shows "… hasn't confirmed they're awake", with a
 *       button that opens the dialler on their number when they shared one.</li>
 *   <li>backup_ring (3.3): another of the user's devices reached its backup
 *       level; this one rings ({@link BackupRing}).</li>
 *   <li>backup_stop (3.3): the alarm was stopped there; stop it here.</li>
 * </ul>
 */
public class SomniMessagingService extends FirebaseMessagingService {

    static final String CHANNEL = "buddy_alerts";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if ("backup_ring".equals(type)) {
            String alarmId = data.get("alarmId");
            if (alarmId == null || alarmId.isEmpty()) {
                return;
            }
            AlarmSpec spec = BackupRing.spec(alarmId, data.get("label"), LocalDateTime.now(ZoneId.systemDefault()));
            boolean started = RingService.start(this, spec, System.currentTimeMillis());
            Log.i(AlarmScheduler.TAG, "backup ring for " + alarmId + (started ? " started" : " refused by Android"));
            return;
        }
        if ("backup_stop".equals(type)) {
            RingService.Snapshot now = RingService.current;
            String alarmId = data.get("alarmId");
            // Only the backup ring for that alarm: never an alarm of this device's own.
            if (now != null && now.ids.size() == 1 && BackupRing.stops(now.ids.get(0), alarmId)) {
                RingService.dismiss(this, Verification.none(System.currentTimeMillis()));
                Log.i(AlarmScheduler.TAG, "backup ring for " + alarmId + " stopped: stopped on the other device");
            }
            return;
        }
        BuddyAlertMessage alert = BuddyAlertMessage.from(data);
        if (alert == null) {
            Log.w(AlarmScheduler.TAG, "push ignored: type " + type);
            return;
        }
        show(this, alert);
    }

    /**
     * This device's push token, waiting up to timeoutMs; null without Firebase
     * in this build or without an answer. Never on the main thread.
     */
    static String ownToken(Context context, long timeoutMs) {
        if (FirebaseApp.getApps(context).isEmpty()) {
            return null;
        }
        try {
            return Tasks.await(FirebaseMessaging.getInstance().getToken(), timeoutMs, TimeUnit.MILLISECONDS);
        }
        catch (Exception e) {
            Log.w(AlarmScheduler.TAG, "no push token: " + e);
            return null;
        }
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
