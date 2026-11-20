package app.somniai.alarm.alarms;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.util.Collections;
import org.json.JSONObject;

/**
 * The phone's telemetry (prompt 5.1): {@link WakeTelemetry} kept in
 * device-protected storage, so a ring before the first unlock is measured
 * too, and finished wakes sent through the outbox to {@link #PATH}.
 */
final class Telemetry {

    static final String PATH = "/api/telemetry";
    private static final String PREFS = "somni_telemetry";
    private static final String KEY = "state";
    private static WakeTelemetry instance;

    private Telemetry() {}

    static synchronized WakeTelemetry get(Context context) {
        if (instance != null) {
            return instance;
        }
        SharedPreferences prefs = context.getApplicationContext().createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        instance = new WakeTelemetry(new WakeTelemetry.Store() {
            @Override
            public String read() {
                return prefs.getString(KEY, null);
            }

            @Override
            public void write(String json) {
                prefs.edit().putString(KEY, json).commit();
            }
        });
        return instance;
    }

    /** A finished wake, queued for the server with the ring's own calls. */
    static void send(Context context, JSONObject wake) {
        Outbox.enqueue(context, Collections.singletonList(new SyncCalls.Call(wake.optString("alarmId"), PATH, wake)));
        Log.i(AlarmScheduler.TAG, "telemetry: queued the wake for " + wake.optString("alarmId") + " (" + wake.optString("outcome")
            + ", " + wake.optInt("snoozes") + " snooze(s), first interaction " + wake.opt("firstInteractionMs") + " ms)");
    }

    /** Drops everything not yet sent: open wakes and queued ones. Returns how many. */
    static int purge(Context context) {
        int open = get(context).clear();
        int queued = Outbox.queue(context).removeWhere(PATH);
        Log.i(AlarmScheduler.TAG, "telemetry: dropped " + open + " open and " + queued + " queued wake(s)");
        return open + queued;
    }
}
