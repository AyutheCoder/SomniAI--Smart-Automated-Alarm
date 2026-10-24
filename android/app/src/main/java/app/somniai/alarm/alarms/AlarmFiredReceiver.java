package app.somniai.alarm.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AlarmManager delivers here when an alarm is due. Direct-boot aware, so an
 * alarm still goes off after an overnight reboot before the phone is unlocked.
 *
 * For now it posts a notification: the foreground service that rings on the
 * alarm stream and the full-screen screen are prompt 2.3.
 */
public class AlarmFiredReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra(AlarmScheduler.EXTRA_ID);
        long scheduledFor = intent.getLongExtra(AlarmScheduler.EXTRA_AT, -1);
        AlarmScheduler.onFired(context, id, scheduledFor);
    }
}
