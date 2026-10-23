package app.somniai.alarm.alarms;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.time.ZoneId;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The web app's handle on native alarms (lib/native/somniAlarm.ts).
 *
 * Every answer says what actually happened: an alarm reported "scheduled" was
 * handed to AlarmManager; one that couldn't be says why.
 */
@CapacitorPlugin(
    name = "SomniAlarm",
    permissions = { @Permission(alias = SomniAlarmPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class SomniAlarmPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    /** Every app start reschedules, which also restores alarms a force-stop deleted. */
    @Override
    public void load() {
        AlarmScheduler.rescheduleAll(getContext(), "app_start", ZoneId.systemDefault());
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSObject alarm = call.getObject("alarm");
        if (alarm == null) {
            call.reject("alarm is required", "INVALID");
            return;
        }
        AlarmRecord record;
        try {
            record = AlarmScheduler.put(getContext(), AlarmCodec.specFromJson(alarm));
        }
        catch (IllegalArgumentException e) {
            call.reject(e.getMessage(), "INVALID");
            return;
        }
        call.resolve(withAccess(json(record)));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id is required", "INVALID");
            return;
        }
        JSObject out = new JSObject();
        out.put("id", id);
        out.put("removed", AlarmScheduler.remove(getContext(), id));
        call.resolve(out);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray alarms = new JSArray();
        for (AlarmRecord r : AlarmScheduler.list(getContext())) {
            alarms.put(json(r));
        }
        JSObject out = new JSObject();
        out.put("alarms", alarms);
        out.put("log", AlarmStore.readLog(getContext()));
        call.resolve(withAccess(out));
    }

    @PluginMethod
    public void exactAlarmStatus(PluginCall call) {
        call.resolve(withAccess(new JSObject()));
    }

    /**
     * Opens "Alarms &amp; reminders" for this app, only where the user can
     * change it (Android 12/12L). Resolves with the state after they return,
     * having rescheduled if it was turned on.
     */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (AlarmScheduler.access(getContext()) != ExactAlarmAccess.State.NEEDS_USER) {
            call.resolve(withAccess(new JSObject().put("opened", false)));
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "exactAlarmSettingsResult");
    }

    @ActivityCallback
    private void exactAlarmSettingsResult(PluginCall call, ActivityResult result) {
        if (ExactAlarmAccess.canSchedule(AlarmScheduler.access(getContext()))) {
            AlarmScheduler.rescheduleAll(getContext(), "exact_alarm_settings", ZoneId.systemDefault());
        }
        call.resolve(withAccess(new JSObject().put("opened", true)));
    }

    /** Whether alarm notifications can be shown. Below Android 13 there is no runtime prompt. */
    @PluginMethod
    public void notificationStatus(PluginCall call) {
        call.resolve(notifications());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.resolve(notifications());
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        call.resolve(notifications());
    }

    private JSObject notifications() {
        JSObject out = new JSObject();
        out.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        return out;
    }

    private JSObject withAccess(JSObject out) {
        ExactAlarmAccess.State state = AlarmScheduler.access(getContext());
        JSObject access = new JSObject();
        access.put("state", state.name().toLowerCase());
        String permission = ExactAlarmAccess.permissionFor(Build.VERSION.SDK_INT);
        access.put("permission", permission == null ? JSONObject.NULL : permission);
        access.put("sdk", Build.VERSION.SDK_INT);
        out.put("exactAlarm", access);
        return out;
    }

    private static JSObject json(AlarmRecord record) {
        try {
            return JSObject.fromJSONObject(AlarmCodec.recordToJson(record));
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
