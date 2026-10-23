package app.somniai.alarm.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Schedules every stored alarm again when Android may have dropped them or
 * moved the clock under them:
 * <ul>
 *   <li>BOOT_COMPLETED / LOCKED_BOOT_COMPLETED: alarms do not survive a
 *       reboot. LOCKED_ comes before the first unlock; this receiver is
 *       direct-boot aware so it runs then. On Android 15+ BOOT_COMPLETED is
 *       also delivered on the first launch after a force-stop, which deletes
 *       an app's alarms.</li>
 *   <li>TIME_SET, TIMEZONE_CHANGED: the wall-clock times map to new instants.</li>
 *   <li>MY_PACKAGE_REPLACED: after an app update.</li>
 *   <li>SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED: Android 12/12L, the
 *       user turned "Alarms &amp; reminders" on (it is not sent when turned off;
 *       turning it off deletes the alarms and stops the app).</li>
 * </ul>
 * All of these are protected broadcasts only the system can send, and all may
 * be received by a manifest receiver on Android 8+ (the implicit-broadcast
 * exceptions list, and MY_PACKAGE_REPLACED goes only to the app replaced).
 */
public class RescheduleReceiver extends BroadcastReceiver {

    static final Set<String> ACTIONS = new HashSet<>(Arrays.asList(
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_LOCKED_BOOT_COMPLETED,
        Intent.ACTION_TIME_CHANGED,
        Intent.ACTION_TIMEZONE_CHANGED,
        Intent.ACTION_MY_PACKAGE_REPLACED,
        // AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED, API 31.
        "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
    ));

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!ACTIONS.contains(action)) {
            return;
        }
        AlarmScheduler.rescheduleAll(context, action, zoneOf(intent));
    }

    /** The new zone from TIMEZONE_CHANGED itself, in case the process default lags. */
    private static ZoneId zoneOf(Intent intent) {
        String id = Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction()) ? intent.getStringExtra(Intent.EXTRA_TIMEZONE) : null;
        if (id != null) {
            try {
                return ZoneId.of(id);
            }
            catch (DateTimeException ignored) {
                // Fall through to the system default.
            }
        }
        return ZoneId.systemDefault();
    }
}
