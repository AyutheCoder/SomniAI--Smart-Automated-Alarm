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
 *
 * SCHEDULE sets a one-off alarm "device-test" at the start of the minute
 * {@code minutes} from now (or repeating daily with --ez daily true). Results
 * go to logcat under the tag SomniAlarm.
 */
public class DebugAlarmReceiver extends BroadcastReceiver {

    private static final String ID = "device-test";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = String.valueOf(intent.getAction());
        try {
            if (action.endsWith(".SCHEDULE")) {
                int minutes = intent.getIntExtra("minutes", 2);
                boolean daily = intent.getBooleanExtra("daily", false);
                LocalDateTime at = LocalDateTime.now(ZoneId.systemDefault()).plusMinutes(minutes).truncatedTo(ChronoUnit.MINUTES);
                AlarmSpec spec = new AlarmSpec(ID, "Device test", at.getHour(), at.getMinute(),
                    daily ? EnumSet.allOf(DayOfWeek.class) : EnumSet.noneOf(DayOfWeek.class),
                    daily ? null : at.toLocalDate(), true, null);
                AlarmRecord r = AlarmScheduler.put(context, spec);
                Log.i(AlarmScheduler.TAG, "debug: set " + ID + " -> " + AlarmCodec.recordToJson(r));
            }
            else if (action.endsWith(".CANCEL")) {
                Log.i(AlarmScheduler.TAG, "debug: removed " + ID + ": " + AlarmScheduler.remove(context, ID));
            }
            else if (action.endsWith(".LIST")) {
                for (AlarmRecord r : AlarmScheduler.list(context)) {
                    Log.i(AlarmScheduler.TAG, "debug: alarm " + AlarmCodec.recordToJson(r));
                }
                Log.i(AlarmScheduler.TAG, "debug: log " + AlarmStore.readLog(context) + " exact alarms " + AlarmScheduler.access(context));
            }
        }
        catch (IllegalArgumentException e) {
            Log.e(AlarmScheduler.TAG, "debug: " + e.getMessage());
        }
    }
}
