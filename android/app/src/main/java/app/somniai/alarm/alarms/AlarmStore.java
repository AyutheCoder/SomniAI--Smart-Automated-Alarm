package app.somniai.alarm.alarms;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The alarms, kept on the phone so they outlive the app's process.
 *
 * Device-protected storage: after a reboot, Android delivers
 * LOCKED_BOOT_COMPLETED before the user first unlocks the phone, and only this
 * storage is readable then. Without it an overnight reboot (a system update)
 * would leave no alarms until someone unlocked the phone, possibly after the
 * alarm should have rung. What is kept is what an alarm needs to ring: time,
 * days, label and ring plan.
 *
 * Writes use commit(), not apply(): a receiver's process can be killed as soon
 * as it returns, and the alarm must already be on disk by then.
 */
final class AlarmStore {

    private static final String PREFS = "somni_alarms";
    private static final String ALARM = "alarm:";
    private static final String LOG = "log";
    private static final int LOG_SIZE = 50;

    /** Every read-modify-write of alarms (plugin thread and receivers) holds this. */
    static final Object LOCK = new Object();

    private AlarmStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static List<AlarmRecord> all(Context context) {
        List<AlarmRecord> out = new ArrayList<>();
        for (Map.Entry<String, ?> e : prefs(context).getAll().entrySet()) {
            if (e.getKey().startsWith(ALARM) && e.getValue() instanceof String) {
                AlarmRecord r = parse(e.getKey(), (String) e.getValue());
                if (r != null) {
                    out.add(r);
                }
            }
        }
        return out;
    }

    static AlarmRecord get(Context context, String id) {
        String raw = prefs(context).getString(ALARM + id, null);
        return raw == null ? null : parse(ALARM + id, raw);
    }

    static void put(Context context, AlarmRecord record) {
        if (!prefs(context).edit().putString(ALARM + record.spec.id, AlarmCodec.recordToJson(record).toString()).commit()) {
            throw new IllegalStateException("could not save alarm " + record.spec.id);
        }
    }

    static boolean remove(Context context, String id) {
        SharedPreferences p = prefs(context);
        boolean had = p.contains(ALARM + id);
        p.edit().remove(ALARM + id).commit();
        return had;
    }

    /** Appends to the record of what happened to alarms (rang, missed, dropped), newest last. */
    static void log(Context context, JSONObject entry) {
        JSONArray kept = readLog(context);
        JSONArray next = new JSONArray();
        for (int i = Math.max(0, kept.length() - (LOG_SIZE - 1)); i < kept.length(); i++) {
            next.put(kept.opt(i));
        }
        next.put(entry);
        prefs(context).edit().putString(LOG, next.toString()).commit();
    }

    static JSONArray readLog(Context context) {
        try {
            return new JSONArray(prefs(context).getString(LOG, "[]"));
        }
        catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static AlarmRecord parse(String key, String raw) {
        try {
            return AlarmCodec.recordFromJson(new JSONObject(raw));
        }
        catch (JSONException | IllegalArgumentException e) {
            // One unreadable entry must not stop every other alarm from being scheduled.
            Log.e(AlarmScheduler.TAG, "skipping unreadable " + key + ": " + e.getMessage());
            return null;
        }
    }
}
