package app.somniai.alarm.alarms;

/**
 * Whether this app may schedule exact alarms, by Android version. Pure, so
 * every version's branch is tested on the JVM (ExactAlarmAccessTest).
 *
 * From the Android documentation and the SDK's own Javadoc, checked 2026-10-24
 * (sources in ANDROID.md, "Exact alarms"):
 * <ul>
 *   <li>Android 8 to 11 (API 26-30): no permission; setAlarmClock always works.</li>
 *   <li>Android 12 and 12L (API 31-32): needs SCHEDULE_EXACT_ALARM, the
 *       "Alarms &amp; reminders" special access, which the user can turn off.
 *       setAlarmClock throws SecurityException without it.</li>
 *   <li>Android 13 and up (API 33+): USE_EXACT_ALARM, a normal permission
 *       granted at install that the user cannot revoke. Google Play allows it
 *       for "an alarm or timer app". The manifest caps SCHEDULE_EXACT_ALARM at
 *       API 32, so on 33+ this app holds only USE_EXACT_ALARM.</li>
 * </ul>
 * canScheduleExactAlarms() is still asked on 31+: it is the documented check,
 * and if it ever says no, the app says so rather than pretending.
 */
public final class ExactAlarmAccess {

    public enum State {
        /** No permission exists on this version. */
        NOT_REQUIRED,
        GRANTED,
        /** Android 12/12L with the special access turned off: the user can turn it on in Settings. */
        NEEDS_USER,
        /** Refused with nothing the user can do in Settings (not expected on 33+). */
        UNAVAILABLE,
    }

    public static final int S = 31;
    public static final int TIRAMISU = 33;

    private ExactAlarmAccess() {}

    /**
     * @param sdk Build.VERSION.SDK_INT
     * @param canScheduleExact AlarmManager.canScheduleExactAlarms(), ignored below API 31
     */
    public static State decide(int sdk, boolean canScheduleExact) {
        if (sdk < S) {
            return State.NOT_REQUIRED;
        }
        if (canScheduleExact) {
            return State.GRANTED;
        }
        return sdk < TIRAMISU ? State.NEEDS_USER : State.UNAVAILABLE;
    }

    /** The permission that grants it on this version, or null below API 31. */
    public static String permissionFor(int sdk) {
        if (sdk < S) {
            return null;
        }
        return sdk < TIRAMISU ? "android.permission.SCHEDULE_EXACT_ALARM" : "android.permission.USE_EXACT_ALARM";
    }

    public static boolean canSchedule(State state) {
        return state == State.NOT_REQUIRED || state == State.GRANTED;
    }
}
