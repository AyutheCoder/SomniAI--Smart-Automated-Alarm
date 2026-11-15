package app.somniai.alarm.alarms;

import android.content.Context;
import android.util.Log;

import androidx.work.WorkManager;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The account was deleted on the server (prompt 7.2): this phone forgets what
 * it held for it. Every alarm is cancelled with AlarmManager and forgotten with
 * its history, the calls still waiting for the server are dropped (they would
 * only be refused now), open and queued telemetry is dropped and consent set
 * to off, and the bedtime plan goes. The phone's own settings stay: the
 * battery-manager confirmation, the push address (it belongs to the install,
 * and the server no longer has it), the volume to restore after a ring.
 *
 * Health Connect and screen time are read when asked and never kept here.
 */
final class AccountReset {

    private AccountReset() {}

    static JSONObject forget(Context context) {
        int alarms = AlarmScheduler.forgetAll(context);
        int telemetry = Telemetry.get(context).setConsent(false, null, System.currentTimeMillis());
        int queued = Outbox.queue(context).clear();
        try {
            WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(Outbox.WORK);
        }
        catch (IllegalStateException e) {
            // Before the first unlock there is no WorkManager; with an empty queue a later sync sends nothing.
            Log.w(AlarmScheduler.TAG, "outbox sync not cancelled: " + e.getMessage());
        }
        PreflightProbe.forgetPlans(context);
        Log.i(AlarmScheduler.TAG, "account deleted: forgot " + alarms + " alarm(s), " + queued + " unsent call(s), " + telemetry + " open wake(s)");
        try {
            return new JSONObject().put("alarms", alarms).put("unsent", queued).put("openWakes", telemetry);
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
