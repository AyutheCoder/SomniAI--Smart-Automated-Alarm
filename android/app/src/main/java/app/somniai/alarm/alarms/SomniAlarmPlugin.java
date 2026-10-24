package app.somniai.alarm.alarms;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioManager;
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
        // Anything queued before the first unlock, or while WorkManager was unavailable.
        Outbox.scheduleSync(getContext());
    }

    /** Ring results waiting to be sent to the server, oldest first. */
    @PluginMethod
    public void pendingSync(PluginCall call) {
        JSObject out = new JSObject();
        out.put("calls", Outbox.queue(getContext()).pending());
        call.resolve(out);
    }

    /** Tries to send the queue now, and says what happened. */
    @PluginMethod
    public void syncNow(PluginCall call) {
        new Thread(() -> {
            OutboxQueue.Flush f = Outbox.flushNow(getContext());
            JSObject out = new JSObject();
            out.put("sent", f.sent);
            out.put("dropped", new JSArray(f.dropped));
            out.put("waiting", Outbox.queue(getContext()).size());
            out.put("lastStatus", f.lastStatus);
            call.resolve(out);
        }, "somni-sync").start();
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

    /**
     * What decides whether a ringing alarm is seen and heard: the full-screen
     * permission (Android 14+), notifications, the alarm volume and Do Not
     * Disturb. Read-only; nothing here changes a setting.
     */
    @PluginMethod
    public void ringStatus(PluginCall call) {
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        AudioManager audio = getContext().getSystemService(AudioManager.class);
        JSObject out = new JSObject();
        out.put("fullScreenIntent", Build.VERSION.SDK_INT < 34 ? "not_required" : nm.canUseFullScreenIntent() ? "granted" : "denied");
        out.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        out.put("alarmVolume", audio.getStreamVolume(AudioManager.STREAM_ALARM));
        out.put("alarmVolumeMax", audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        int filter = nm.getCurrentInterruptionFilter();
        out.put("doNotDisturb", filter == NotificationManager.INTERRUPTION_FILTER_NONE ? "total_silence"
            : filter == NotificationManager.INTERRUPTION_FILTER_ALARMS ? "alarms_only"
            : filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY ? "priority" : "off");
        call.resolve(out);
    }

    /** Opens the full-screen setting for this app on Android 14+; otherwise opened is false. */
    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
            Uri.parse("package:" + getContext().getPackageName())));
        call.resolve(new JSObject().put("opened", true));
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
