package app.somniai.alarm.alarms;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.util.Log;

/**
 * Raising the alarm stream while ringing, and putting it back afterwards, so
 * that it gets put back even when the ring never ended normally. The phone was
 * rebooted mid-ring, or the process died: found on the emulator in prompt 2.7,
 * where a reboot during a ring left the user's alarm volume at the top.
 *
 * What the user had and what it was raised to are kept in device-protected
 * storage, written before the raise, and restored at the end of the ring or,
 * failing that, at the next app start or reboot. It is only put back if it is
 * still where it was raised to; if the user changed it since, their setting stays.
 */
final class AlarmVolume {

    private static final String PREFS = "somni_volume";
    private static final String ORIGINAL = "original";
    private static final String RAISED_TO = "raisedTo";

    private AlarmVolume() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Raises the alarm stream to {@code target}; remembers the user's own level from the first raise. */
    static boolean raise(Context context, int target) {
        AudioManager audio = context.getSystemService(AudioManager.class);
        int now = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        if (target <= now) {
            return false;
        }
        SharedPreferences p = prefs(context);
        int original = p.getInt(ORIGINAL, -1);
        p.edit().putInt(ORIGINAL, original >= 0 ? original : now).putInt(RAISED_TO, target).commit();
        try {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, target, 0);
            Log.i(AlarmScheduler.TAG, "alarm volume raised from " + now + " to " + target + " while ringing");
            return true;
        }
        catch (SecurityException e) {
            Log.w(AlarmScheduler.TAG, "could not raise the alarm volume: " + e);
            return false;
        }
    }

    /** Puts back a raise not yet undone. Returns what it did, for the log. */
    static String restore(Context context) {
        SharedPreferences p = prefs(context);
        int original = p.getInt(ORIGINAL, -1);
        int raisedTo = p.getInt(RAISED_TO, -1);
        if (original < 0) {
            return "nothing to restore";
        }
        AudioManager audio = context.getSystemService(AudioManager.class);
        int now = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        int to = RingTuning.restoreTo(now, original, raisedTo);
        String did;
        if (to >= 0) {
            try {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, to, 0);
                did = "alarm volume put back from " + now + " to " + to;
            }
            catch (SecurityException e) {
                did = "could not put the alarm volume back: " + e;
            }
        }
        else {
            did = "alarm volume left at " + now + ": changed since it was raised to " + raisedTo;
        }
        p.edit().clear().commit();
        Log.i(AlarmScheduler.TAG, did);
        return did;
    }

    /** At app start and boot: undo a raise left behind by a ring that never ended normally. */
    static void restoreIfNotRinging(Context context) {
        if (RingService.current == null && prefs(context).getInt(ORIGINAL, -1) >= 0) {
            restore(context);
        }
    }
}
