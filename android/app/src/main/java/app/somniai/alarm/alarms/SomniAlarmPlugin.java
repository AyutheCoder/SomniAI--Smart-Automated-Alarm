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
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
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

    /**
     * What this native code offers, for the web app's check before it relies on
     * it (lib/nativeSync.ts). Raised when the plugin gains something the web app
     * needs: 1 is schedule/cancel/list (2.2), 2 adds reconcile (2.5), 3 the
     * bedtime check (3.1), 4 the push token for wake-buddy alerts (3.2),
     * 5 Health Connect (4.2), 6 screen time before bed (4.3), 7 telemetry
     * consent and snooze on the ring screen (5.1).
     */
    static final int API = 7;

    @PluginMethod
    public void version(PluginCall call) {
        call.resolve(new JSObject().put("api", API));
    }

    /** Every bedtime check now, as the check screen shows them. Read-only. */
    @PluginMethod
    public void preflight(PluginCall call) {
        List<Preflight.Check> checks = Preflight.run(PreflightProbe.read(getContext()));
        JSArray out = new JSArray();
        for (Preflight.Check c : checks) {
            JSObject o = new JSObject();
            o.put("id", c.id);
            o.put("status", c.status.name().toLowerCase());
            o.put("title", c.title);
            o.put("detail", c.detail);
            out.put(o);
        }
        call.resolve(new JSObject().put("checks", out).put("attention", Preflight.attention(checks)));
    }

    /**
     * This phone's push token, for wake-buddy alerts (the page sends it to the
     * server). A build without google-services.json has no Firebase: it says
     * so rather than failing.
     */
    @PluginMethod
    public void pushToken(PluginCall call) {
        if (com.google.firebase.FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve(new JSObject().put("available", false)
                .put("reason", "Push isn't set up in this build of the app (no Firebase configuration)."));
            return;
        }
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                call.resolve(new JSObject().put("available", true).put("token", task.getResult()));
            }
            else {
                Exception e = task.getException();
                call.resolve(new JSObject().put("available", false)
                    .put("reason", "This phone couldn't get a push token" + (e == null ? "" : ": " + e.getMessage())));
            }
        });
    }

    /**
     * API 5: Health Connect on this phone (prompt 4.2): "available",
     * "not_installed" or "update_required", and which of SomniAI's two read
     * permissions are granted.
     */
    @PluginMethod
    public void healthStatus(PluginCall call) {
        new Thread(() -> call.resolve(healthState(null)), "health-status").start();
    }

    private JSObject healthState(Set<String> justGranted) {
        String status = HealthConnect.status(getContext());
        JSObject o = new JSObject().put("status", status);
        Set<String> granted = justGranted;
        if ("available".equals(status) && granted == null) {
            try {
                granted = HealthConnect.granted(getContext());
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return o.put("granted", new JSArray()).put("allGranted", false).put("error", "interrupted");
            }
            catch (RuntimeException e) {
                return o.put("granted", new JSArray()).put("allGranted", false).put("error", e.toString());
            }
        }
        JSArray list = new JSArray();
        if (granted != null) {
            for (String p : granted) {
                if (HealthConnect.PERMISSIONS.contains(p)) {
                    list.put(p);
                }
            }
        }
        return o.put("granted", list).put("allGranted", granted != null && granted.containsAll(HealthConnect.PERMISSIONS));
    }

    /** API 5: Health Connect's own screen asking for sleep and resting heart rate, read-only. */
    @PluginMethod
    public void requestHealthPermissions(PluginCall call) {
        if (!"available".equals(HealthConnect.status(getContext()))) {
            call.resolve(healthState(null));
            return;
        }
        startActivityForResult(call, HealthConnect.permissionIntent(getContext()), "healthPermissionsResult");
    }

    @ActivityCallback
    private void healthPermissionsResult(PluginCall call, ActivityResult result) {
        Set<String> granted = HealthConnect.permissionContract().parseResult(result.getResultCode(), result.getData());
        new Thread(() -> {
            // What the screen returned, or if it returned nothing, what Health Connect now says.
            JSObject state = healthState(granted.isEmpty() ? null : granted);
            android.util.Log.i(AlarmScheduler.TAG, "health permissions: " + state.optJSONArray("granted"));
            call.resolve(state);
        }, "health-permissions").start();
    }

    /**
     * API 5: the last two weeks of nights from Health Connect, folded as the
     * paper did (HealthNights), for the page to send to the server. Reads only
     * what was granted.
     */
    @PluginMethod
    public void readSleep(PluginCall call) {
        new Thread(() -> {
            String status = HealthConnect.status(getContext());
            if (!"available".equals(status)) {
                call.resolve(new JSObject().put("status", status).put("nights", new JSArray()).put("skipped", new JSArray()));
                return;
            }
            try {
                HealthNights.Result r = HealthConnect.readNights(getContext(), Instant.now(), ZoneId.systemDefault());
                JSObject out = JSObject.fromJSONObject(HealthNights.toJson(r));
                android.util.Log.i(AlarmScheduler.TAG, "health: " + r.nights.size() + " night(s) read, skipped " + r.skipped);
                call.resolve(out.put("status", status));
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("interrupted");
            }
            catch (RuntimeException | JSONException e) {
                android.util.Log.w(AlarmScheduler.TAG, "health: read failed: " + e);
                call.reject("Couldn't read Health Connect: " + e.getMessage());
            }
        }, "health-read").start();
    }

    /** API 5: Health Connect itself, to manage access; or its Play Store page if it isn't installed. */
    @PluginMethod
    public void openHealthConnect(PluginCall call) {
        Intent intent = "not_installed".equals(HealthConnect.status(getContext()))
            ? new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + HealthConnect.PROVIDER))
            : new Intent(androidx.health.connect.client.HealthConnectClient.Companion.getHealthConnectSettingsAction());
        try {
            getActivity().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        }
        catch (android.content.ActivityNotFoundException e) {
            call.resolve(new JSObject().put("opened", false));
        }
    }

    /**
     * API 7: telemetry on this phone (prompt 5.1): the consent it holds, the
     * wakes still open (between a snooze and the next ring) and those queued.
     */
    @PluginMethod
    public void telemetryStatus(PluginCall call) {
        call.resolve(telemetryState());
    }

    private JSONObject telemetryRaw() {
        WakeTelemetry.Consent c = Telemetry.get(getContext()).consent();
        int queued = 0;
        org.json.JSONArray pending = Outbox.queue(getContext()).pending();
        for (int i = 0; i < pending.length(); i++) {
            if (Telemetry.PATH.equals(pending.optJSONObject(i).optString("path"))) {
                queued++;
            }
        }
        JSONObject o = new JSONObject();
        try {
            o.put("granted", c.granted);
            o.put("version", c.version == null ? JSONObject.NULL : c.version);
            o.put("openWakes", Telemetry.get(getContext()).openWakes());
            o.put("queued", queued);
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return o;
    }

    private JSObject telemetryState() {
        try {
            return JSObject.fromJSONObject(telemetryRaw());
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * API 7: the consent the user gave or withdrew, as the server holds it.
     * Recording starts with the next ring after it is given; withdrawing drops
     * everything not yet sent, open and queued.
     */
    @PluginMethod
    public void setTelemetryConsent(PluginCall call) {
        Boolean granted = call.getBoolean("granted");
        String version = call.getString("version");
        if (granted == null || (granted && (version == null || version.isEmpty()))) {
            call.reject("granted is required, and a version with it", "INVALID");
            return;
        }
        Telemetry.get(getContext()).setConsent(granted, granted ? version : null, System.currentTimeMillis());
        int dropped = granted ? 0 : Telemetry.purge(getContext());
        android.util.Log.i(AlarmScheduler.TAG, "telemetry consent " + (granted ? "given (" + version + ")" : "withdrawn; dropped " + dropped));
        call.resolve(telemetryState().put("dropped", dropped));
    }

    /** API 7: drops every wake not yet sent (the user deleted their telemetry). */
    @PluginMethod
    public void clearTelemetry(PluginCall call) {
        int dropped = Telemetry.purge(getContext());
        call.resolve(telemetryState().put("dropped", dropped));
    }

    /** API 6: whether Usage access is on, for screen time before bed (prompt 4.3). */
    @PluginMethod
    public void screenTimeStatus(PluginCall call) {
        call.resolve(new JSObject().put("allowed", ScreenUsage.allowed(getContext())));
    }

    /**
     * API 6: Settings' Usage access page, where the user turns it on. The page
     * explains why before calling this, and checks again when the app is back.
     */
    @PluginMethod
    public void openUsageAccess(PluginCall call) {
        for (Intent intent : ScreenUsage.settingsIntents(getContext())) {
            try {
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("opened", true));
                return;
            }
            catch (android.content.ActivityNotFoundException | SecurityException e) {
                // This phone has no page for one app: try the list.
            }
        }
        call.resolve(new JSObject().put("opened", false));
    }

    /**
     * API 6: the last week's screen time before bed, a night per wake date
     * (ScreenNights). {@code bedtimes} are the sleep log's, {"2026-11-14":
     * "2026-11-13T17:30:00Z"}; other nights use the phone's own reading of
     * bed. Without Usage access nothing is read.
     */
    @PluginMethod
    public void readScreenTime(PluginCall call) {
        JSObject given = call.getObject("bedtimes");
        new Thread(() -> {
            if (!ScreenUsage.allowed(getContext())) {
                call.resolve(new JSObject().put("allowed", false).put("nights", new JSArray()).put("skipped", new JSArray()));
                return;
            }
            try {
                ScreenNights.Result r = ScreenUsage.read(getContext(), ScreenNights.bedtimesFrom(given), Instant.now(), ZoneId.systemDefault());
                android.util.Log.i(AlarmScheduler.TAG, "screen time: " + r.nights.size() + " night(s), skipped " + r.skipped);
                call.resolve(JSObject.fromJSONObject(ScreenNights.toJson(r)).put("allowed", true));
            }
            catch (RuntimeException | JSONException e) {
                android.util.Log.w(AlarmScheduler.TAG, "screen time: read failed: " + e);
                call.reject("Couldn't read screen time: " + e.getMessage());
            }
        }, "screen-time").start();
    }

    /** Opens "Tonight's alarm check", where each failing setting has its fix. */
    @PluginMethod
    public void openPreflight(PluginCall call) {
        getActivity().startActivity(new Intent(getContext(), PreflightActivity.class));
        call.resolve();
    }

    /**
     * The planned bedtime from the wake plan (ISO time), or null to clear it.
     * The bedtime check runs half an hour before it (PreflightSchedule).
     */
    @PluginMethod
    public void setBedtime(PluginCall call) {
        String at = call.getString("at");
        Long ms = null;
        if (at != null) {
            try {
                ms = java.time.Instant.parse(at).toEpochMilli();
            }
            catch (java.time.format.DateTimeParseException e) {
                call.reject("at must be an ISO time", "INVALID");
                return;
            }
        }
        PreflightProbe.setBedtime(getContext(), ms);
        PreflightReceiver.update(getContext());
        call.resolve(new JSObject().put("bedtime", at));
    }

    /**
     * Makes the phone's schedule match the server's full list of alarms
     * (ReconcilePlan has the rules). Idempotent: unchanged alarms are not
     * touched. Rejects with INVALID, changing nothing, for a malformed alarm,
     * a non-server id, or an id listed twice.
     */
    @PluginMethod
    public void reconcile(PluginCall call) {
        JSArray alarms = call.getArray("alarms");
        if (alarms == null) {
            call.reject("alarms is required", "INVALID");
            return;
        }
        List<AlarmSpec> desired = new ArrayList<>();
        try {
            for (int i = 0; i < alarms.length(); i++) {
                desired.add(AlarmCodec.specFromJson(alarms.getJSONObject(i)));
            }
        }
        catch (JSONException | IllegalArgumentException e) {
            call.reject("alarm " + desired.size() + ": " + e.getMessage(), "INVALID");
            return;
        }
        ReconcilePlan plan;
        try {
            plan = AlarmScheduler.reconcile(getContext(), desired);
        }
        catch (IllegalArgumentException e) {
            call.reject(e.getMessage(), "INVALID");
            return;
        }
        List<String> put = new ArrayList<>();
        for (AlarmSpec spec : plan.put) {
            put.add(spec.id);
        }
        JSObject out = new JSObject();
        out.put("put", new JSArray(put));
        out.put("removed", new JSArray(plan.remove));
        out.put("unchanged", new JSArray(plan.unchanged));
        out.put("keptHistory", new JSArray(plan.keptHistory));
        out.put("past", new JSArray(plan.past));
        call.resolve(withAccess(out));
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
