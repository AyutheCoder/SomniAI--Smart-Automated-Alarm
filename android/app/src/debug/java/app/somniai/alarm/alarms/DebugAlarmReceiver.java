package app.somniai.alarm.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;

/**
 * Debug builds only. From adb:
 *
 *   adb shell am broadcast -a app.somniai.alarm.debug.SCHEDULE -n app.somniai.alarm/.alarms.DebugAlarmReceiver --ei minutes 2
 *   adb shell am broadcast -a app.somniai.alarm.debug.LIST -n app.somniai.alarm/.alarms.DebugAlarmReceiver
 *   adb shell am broadcast -a app.somniai.alarm.debug.CANCEL -n app.somniai.alarm/.alarms.DebugAlarmReceiver
 *   adb shell am broadcast -a app.somniai.alarm.debug.DISMISS -n app.somniai.alarm/.alarms.DebugAlarmReceiver
 *
 * SCHEDULE sets a one-off alarm "device-test" at the start of the minute
 * {@code minutes} from now (or repeating daily with --ez daily true). It asks
 * for the native wake check unless --ez check false; --ei min N sets the
 * check's minConfidence (default 70). DISMISS can only stop an alarm that
 * needs no check: it has no check to show, and the service refuses it
 * otherwise. SCHEDULE and CANCEL take --es id ID (default "device-test"): give
 * a real alarm id from the web app and the ring's result is accepted by the
 * server when it syncs. LIST also shows the results waiting to sync; SYNC
 * tries to send them now. PREFLIGHT logs the bedtime check and opens its
 * screen (--ez open false to only log). Results go to logcat under the tag
 * SomniAlarm.
 */
public class DebugAlarmReceiver extends BroadcastReceiver {

    private static final String DEFAULT_ID = "device-test";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = String.valueOf(intent.getAction());
        String id = intent.getStringExtra("id") == null ? DEFAULT_ID : intent.getStringExtra("id");
        try {
            if (action.endsWith(".SCHEDULE")) {
                int minutes = intent.getIntExtra("minutes", 2);
                boolean daily = intent.getBooleanExtra("daily", false);
                String plan = "{\"version\":1,\"challenge\":{\"required\":" + intent.getBooleanExtra("check", true)
                    + ",\"methods\":[\"math\"],\"minConfidence\":" + intent.getIntExtra("min", 70) + "}}";
                LocalDateTime at = LocalDateTime.now(ZoneId.systemDefault()).plusMinutes(minutes).truncatedTo(ChronoUnit.MINUTES);
                AlarmSpec spec = new AlarmSpec(id, "Device test", at.getHour(), at.getMinute(),
                    daily ? EnumSet.allOf(DayOfWeek.class) : EnumSet.noneOf(DayOfWeek.class),
                    daily ? null : at.toLocalDate(), true, plan);
                AlarmRecord r = AlarmScheduler.put(context, spec);
                Log.i(AlarmScheduler.TAG, "debug: set " + id + " -> " + AlarmCodec.recordToJson(r));
            }
            else if (action.endsWith(".DISMISS")) {
                RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
                Log.i(AlarmScheduler.TAG, "debug: dismiss sent");
            }
            else if (action.endsWith(".CANCEL")) {
                Log.i(AlarmScheduler.TAG, "debug: removed " + id + ": " + AlarmScheduler.remove(context, id));
            }
            else if (action.endsWith(".LIST")) {
                for (AlarmRecord r : AlarmScheduler.list(context)) {
                    Log.i(AlarmScheduler.TAG, "debug: alarm " + AlarmCodec.recordToJson(r));
                }
                Log.i(AlarmScheduler.TAG, "debug: log " + AlarmStore.readLog(context) + " exact alarms " + AlarmScheduler.access(context));
                Log.i(AlarmScheduler.TAG, "debug: waiting to sync " + Outbox.queue(context).size() + ": " + Outbox.queue(context).pending());
            }
            else if (action.endsWith(".PREFLIGHT")) {
                // The bedtime check now: each verdict logged and returned to adb
                // ("Broadcast completed: ... data=..."), and the screen opened.
                StringBuilder verdicts = new StringBuilder();
                for (Preflight.Check c : Preflight.run(PreflightProbe.read(context))) {
                    Log.i(AlarmScheduler.TAG, "debug: preflight " + c.id + " " + c.status.name().toLowerCase() + ": " + c.detail);
                    verdicts.append(c.id).append('=').append(c.status.name().toLowerCase()).append(' ');
                }
                android.app.NotificationManager nm = context.getSystemService(android.app.NotificationManager.class);
                if (intent.getBooleanExtra("clear", false)) {
                    // The bedtime notification, so a test can see whether a new one comes.
                    nm.cancel(PreflightReceiver.NOTIFICATION_ID);
                }
                // Whether it is showing, from the app's own active list: dumpsys's
                // list also kept removed ones on Android 8.
                int showing = 0;
                for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) {
                    if (n.getId() == PreflightReceiver.NOTIFICATION_ID) {
                        showing++;
                    }
                }
                verdicts.append("bedtime_notification=").append(showing);
                setResultData(verdicts.toString().trim());
                if (intent.getBooleanExtra("open", true)) {
                    context.startActivity(new Intent(context, PreflightActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            }
            else if (action.endsWith(".VOLUME")) {
                // The alarm stream as the app sets it (the speaker's, unlike adb's
                // shell, which sets the "default" output's); --ei index N sets it.
                android.media.AudioManager audio = context.getSystemService(android.media.AudioManager.class);
                int s = android.media.AudioManager.STREAM_ALARM;
                if (intent.hasExtra("index")) {
                    audio.setStreamVolume(s, intent.getIntExtra("index", 0), 0);
                }
                int min = android.os.Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(s) : 0;
                setResultData("volume=" + audio.getStreamVolume(s) + " min=" + min + " max=" + audio.getStreamMaxVolume(s));
            }
            else if (action.endsWith(".SYNC")) {
                PendingResult done = goAsync();
                new Thread(() -> {
                    Outbox.flushNow(context);
                    done.finish();
                }, "debug-sync").start();
            }
        }
        catch (IllegalArgumentException e) {
            Log.e(AlarmScheduler.TAG, "debug: " + e.getMessage());
        }
    }
}
