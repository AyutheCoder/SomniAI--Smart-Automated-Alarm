package app.somniai.alarm.alarms;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;

/**
 * Reads the phone's state for {@link Preflight}, and keeps what the check
 * remembers: the user's word on the manufacturer's settings, the planned
 * bedtime, and which alarm was last checked for. Device-protected storage,
 * like the alarms, so it is there before the first unlock.
 */
final class PreflightProbe {

    private static final String PREFS = "somni_preflight";
    private static final String MANAGER_CONFIRMED = "managerConfirmed";
    private static final String BEDTIME = "bedtime";
    private static final String CHECKED_FOR = "checkedFor";

    private PreflightProbe() {}

    static Preflight.Facts read(Context context) {
        Preflight.Facts f = new Preflight.Facts();
        f.sdk = Build.VERSION.SDK_INT;
        f.manufacturer = Build.MANUFACTURER;
        f.brand = Build.BRAND;
        f.exactAlarm = AlarmScheduler.access(context);

        NotificationManager nm = context.getSystemService(NotificationManager.class);
        f.notifications = NotificationManagerCompat.from(context).areNotificationsEnabled();
        f.fullScreen = Build.VERSION.SDK_INT >= 34 ? nm.canUseFullScreenIntent() : null;

        PowerManager pm = context.getSystemService(PowerManager.class);
        f.ignoringBatteryOptimizations = pm.isIgnoringBatteryOptimizations(context.getPackageName());
        f.managerConfirmed = prefs(context).getBoolean(MANAGER_CONFIRMED, false);

        AudioManager audio = context.getSystemService(AudioManager.class);
        f.alarmVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        f.alarmVolumeMax = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
        f.alarmVolumeMin = Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(AudioManager.STREAM_ALARM) : 0;

        switch (nm.getCurrentInterruptionFilter()) {
            case NotificationManager.INTERRUPTION_FILTER_NONE:
                f.dnd = Preflight.Dnd.TOTAL_SILENCE;
                break;
            case NotificationManager.INTERRUPTION_FILTER_ALARMS:
                f.dnd = Preflight.Dnd.ALARMS_ONLY;
                break;
            case NotificationManager.INTERRUPTION_FILTER_PRIORITY:
                f.dnd = Preflight.Dnd.PRIORITY;
                break;
            default:
                f.dnd = Preflight.Dnd.OFF;
        }
        f.dndAllowsAlarms = dndAllowsAlarms(nm);

        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        f.batteryPercent = level < 0 || scale <= 0 ? -1 : Math.round(100f * level / scale);
        f.charging = battery != null && battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        return f;
    }

    /**
     * Whether priority-only Do Not Disturb lets alarms through. Before Android
     * 9 it always did; from 9 the user can block them. Null if the policy
     * can't be read.
     */
    private static Boolean dndAllowsAlarms(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 28) {
            return true;
        }
        try {
            NotificationManager.Policy policy = nm.getNotificationPolicy();
            return policy == null ? null : (policy.priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) != 0;
        }
        catch (RuntimeException e) {
            return null;
        }
    }

    static void setManagerConfirmed(Context context, boolean confirmed) {
        prefs(context).edit().putBoolean(MANAGER_CONFIRMED, confirmed).apply();
    }

    /** The wake plan's bedtime (epoch ms), or null to use the default. */
    static void setBedtime(Context context, Long at) {
        SharedPreferences.Editor e = prefs(context).edit();
        if (at == null) {
            e.remove(BEDTIME);
        }
        else {
            e.putLong(BEDTIME, at);
        }
        e.apply();
    }

    static Long bedtime(Context context) {
        SharedPreferences p = prefs(context);
        return p.contains(BEDTIME) ? p.getLong(BEDTIME, 0) : null;
    }

    static void setCheckedFor(Context context, long alarmAt) {
        prefs(context).edit().putLong(CHECKED_FOR, alarmAt).apply();
    }

    static Long checkedFor(Context context) {
        SharedPreferences p = prefs(context);
        return p.contains(CHECKED_FOR) ? p.getLong(CHECKED_FOR, 0) : null;
    }

    private static SharedPreferences prefs(Context context) {
        return context.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
