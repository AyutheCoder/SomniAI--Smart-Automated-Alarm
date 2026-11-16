package app.somniai.alarm.alarms;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Rings an alarm: a foreground service of type systemExempted, which Android
 * allows "for apps holding SCHEDULE_EXACT_ALARM or USE_EXACT_ALARM" to
 * "continue alarms in the background". Started from the alarm's own delivery,
 * which Android allows to start a foreground service from the background.
 *
 * The decisions are in {@link RingController} (JVM-tested); this class
 * carries them out. Direct-boot aware, so it rings before the first unlock.
 */
public class RingService extends Service implements RingController.Effects {

    static final String ACTION_RING = "app.somniai.alarm.RING";
    static final String ACTION_DISMISS = "app.somniai.alarm.DISMISS";
    /** Snooze from the ring screen (prompt 5.1). */
    static final String ACTION_SNOOZE = "app.somniai.alarm.SNOOZE";
    /** The user interacted with the ring screen: for telemetry's time to first interaction. */
    static final String ACTION_INTERACTION = "app.somniai.alarm.INTERACTION";
    /** On the ring screen's intent from tapping the notification: that tap was an interaction. */
    static final String EXTRA_VIA = "via";
    private static final String EXTRA_ELAPSED = "elapsed";
    /** The wake check was solved but not convincingly: to the top of the ladder. */
    static final String ACTION_ESCALATE = "app.somniai.alarm.ESCALATE";
    /** Sent (to this app only) when the ladder reaches the challenge level. */
    static final String ACTION_CHALLENGE = "app.somniai.alarm.CHALLENGE";
    /** Sent (to this app only) when ringing ends, so the ring screen closes. */
    static final String ACTION_STOPPED = "app.somniai.alarm.RING_STOPPED";
    /** The backup level's answer arrived: the ring screen shows who will be told. */
    static final String ACTION_BACKUPS = "app.somniai.alarm.RING_BACKUPS";
    static final String CHANNEL = "ringing";
    private static final int NOTIFICATION_ID = 7001;
    private static final String EXTRA_ID = "id";
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_AT = "at";
    private static final String EXTRA_PLAN = "plan";
    private static final String EXTRA_VERIFICATION = "verification";

    /**
     * What is ringing now, for the ring screen and the on-device tests. Null
     * when nothing is. Published only between steps (after a start or a ramp
     * tick has finished), never halfway through one.
     */
    static volatile Snapshot current;
    /** Who will be told, and when, once the backup level asked (3.3); null before, or with nobody. */
    static volatile String backupNote;

    static final class Snapshot {
        final List<String> ids;
        final String label;
        final long scheduledFor;
        final RingController.Source source;
        final float volume;
        final boolean vibrating;
        final boolean wakeLockHeld;
        /** The wake check that stops this ring. */
        final WakeCheck.Plan check;
        /** The escalation level the ring is at. */
        final EscalationLadder.Level level;
        /** Whether the ring screen offers Snooze: not for an unmissable alarm or another device's backup ring. */
        final boolean canSnooze;

        Snapshot(List<String> ids, String label, long scheduledFor, RingController.Source source, float volume, boolean vibrating, boolean wakeLockHeld,
                WakeCheck.Plan check, EscalationLadder.Level level, boolean canSnooze) {
            this.ids = ids;
            this.label = label;
            this.scheduledFor = scheduledFor;
            this.source = source;
            this.volume = volume;
            this.vibrating = vibrating;
            this.wakeLockHeld = wakeLockHeld;
            this.check = check;
            this.level = level;
            this.canSnooze = canSnooze;
        }
    }

    /** Starts ringing. Returns false if Android refused to start the service. */
    static boolean start(Context context, AlarmSpec spec, long scheduledFor) {
        Intent intent = new Intent(context, RingService.class).setAction(ACTION_RING)
            .putExtra(EXTRA_ID, spec.id)
            .putExtra(EXTRA_LABEL, spec.label)
            .putExtra(EXTRA_AT, scheduledFor)
            .putExtra(EXTRA_PLAN, spec.ringPlanJson);
        try {
            ContextCompat.startForegroundService(context, intent);
            return true;
        }
        catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException (API 31+) or IllegalStateException.
            Log.e(AlarmScheduler.TAG, "could not start ringing " + spec.id + ": " + e);
            return false;
        }
    }

    /**
     * Asks to stop whatever is ringing, with how the wake check went. The
     * service refuses (and logs it) unless the check passes the ring's plan.
     * Does nothing if nothing is ringing.
     */
    static void escalateToTop(Context context) {
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_ESCALATE));
        }
        catch (IllegalStateException e) {
            Log.i(AlarmScheduler.TAG, "escalate with nothing ringing");
        }
    }

    /** Snoozes what is ringing, unless it is unmissable. Does nothing if nothing is ringing. */
    static void snooze(Context context) {
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_SNOOZE));
        }
        catch (IllegalStateException e) {
            Log.i(AlarmScheduler.TAG, "snooze with nothing ringing");
        }
    }

    /** The user interacted, at this time on the elapsedRealtime clock. */
    static void interacted(Context context, long elapsed, String via) {
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_INTERACTION)
                .putExtra(EXTRA_ELAPSED, elapsed).putExtra(EXTRA_VIA, via));
        }
        catch (IllegalStateException e) {
            Log.i(AlarmScheduler.TAG, "interaction with nothing ringing");
        }
    }

    static void dismiss(Context context, Verification verification) {
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_DISMISS)
                .putExtra(EXTRA_VERIFICATION, verification == null ? null : verification.toJson().toString()));
        }
        catch (IllegalStateException e) {
            // The app is in the background, so no ring service is running: nothing to stop.
            Log.i(AlarmScheduler.TAG, "dismiss with nothing ringing");
        }
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private RingController controller;
    /** The id of the most recent start request, for {@link #stopService}. */
    private int latestStartId;
    private final Runnable tick = () -> {
        controller.tick(System.currentTimeMillis());
        publish();
    };
    private AlarmSound sound;
    private PowerManager.WakeLock wakeLock;
    private Vibrator vibrator;
    private boolean vibrating;
    private float volume;

    @Override
    public void onCreate() {
        super.onCreate();
        controller = new RingController(this);
        sound = new AlarmSound(this, () -> handler.post(() -> controller.soundFailed(System.currentTimeMillis())));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        latestStartId = startId;
        String action = intent == null ? null : intent.getAction();
        long now = System.currentTimeMillis();
        long elapsed = SystemClock.elapsedRealtime();
        if (ACTION_RING.equals(action)) {
            RingController.Alarm alarm = new RingController.Alarm(
                String.valueOf(intent.getStringExtra(EXTRA_ID)),
                String.valueOf(intent.getStringExtra(EXTRA_LABEL)),
                intent.getLongExtra(EXTRA_AT, now),
                WakeCheck.Plan.fromRingPlan(intent.getStringExtra(EXTRA_PLAN)),
                EscalationLadder.fromRingPlan(intent.getStringExtra(EXTRA_PLAN)));
            if (controller.state() != RingController.State.RINGING) {
                backupNote = null;
            }
            boolean already = isRinging(alarm.id);
            controller.start(alarm, RingTuning.fromPlan(intent.getStringExtra(EXTRA_PLAN)), now);
            if (!already && isRinging(alarm.id) && !BackupRing.isBackup(alarm.id)) {
                // Telemetry, with consent only (WakeTelemetry checks): this ring's start on the monotonic clock.
                Telemetry.get(this).ringStarted(alarm.id, alarm.scheduledFor, now, elapsed);
            }
            if (controller.state() == RingController.State.RINGING) {
                List<RingController.Alarm> all = new ArrayList<>();
                for (RingController.Alarm a : controller.ringing()) {
                    all.add(a);
                }
                goForeground(all);
            }
        }
        else if (ACTION_DISMISS.equals(action)) {
            String v = intent.getStringExtra(EXTRA_VERIFICATION);
            Verification verification = null;
            try {
                verification = v == null ? null : Verification.fromJson(v);
            }
            catch (IllegalArgumentException e) {
                Log.w(AlarmScheduler.TAG, "unreadable verification: " + e.getMessage());
            }
            controller.dismiss(now, verification);
        }
        else if (ACTION_ESCALATE.equals(action)) {
            controller.escalateToTop(now);
        }
        else if (ACTION_SNOOZE.equals(action)) {
            controller.snooze(now);
        }
        else if (ACTION_INTERACTION.equals(action)) {
            Telemetry.get(this).interacted(intent.getLongExtra(EXTRA_ELAPSED, elapsed), intent.getStringExtra(EXTRA_VIA));
        }
        if (controller.state() != RingController.State.RINGING) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        publish();
        // If Android kills the process mid-ring, deliver the ring again rather than fall silent.
        return START_REDELIVER_INTENT;
    }

    private boolean isRinging(String id) {
        if (controller.state() != RingController.State.RINGING) {
            return false;
        }
        for (RingController.Alarm a : controller.ringing()) {
            if (a.id.equals(id)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void onDestroy() {
        controller.destroyed(System.currentTimeMillis());
        current = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- Effects ---

    @Override
    public boolean startForeground(RingController.Alarm first) {
        List<RingController.Alarm> one = new ArrayList<>();
        one.add(first);
        return goForeground(one);
    }

    /**
     * startForeground with the notification for these alarms. Android requires
     * it after every startForegroundService call, not only the first: a second
     * alarm going off while one rings, or a redelivered ring, must call it again
     * or the app is killed seconds later (ForegroundServiceDidNotStartInTime,
     * found on the emulator in prompt 2.4).
     */
    private boolean goForeground(List<RingController.Alarm> alarms) {
        Notification n = notification(alarms);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED);
            }
            else {
                startForeground(NOTIFICATION_ID, n);
            }
            return true;
        }
        catch (RuntimeException e) {
            // Still ring: the sound and the notification below are better than silence.
            Log.e(AlarmScheduler.TAG, "startForeground refused: " + e);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
            return false;
        }
        finally {
            openRingScreenIfInUse();
        }
    }

    /**
     * With the phone awake and unlocked, the full-screen intent only shows a banner,
     * which some phones hide: open the ring screen directly (RingScreen says when).
     */
    private void openRingScreenIfInUse() {
        boolean interactive = getSystemService(PowerManager.class).isInteractive();
        boolean locked = getSystemService(KeyguardManager.class).isKeyguardLocked();
        if (!RingScreen.openDirectly(interactive, locked, RingActivity.inFront)) {
            return;
        }
        try {
            startActivity(new Intent(this, RingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION));
            // Android may still hold back a start from the background without saying so; the notification stays.
            Log.i(AlarmScheduler.TAG, "phone in use: opened the ring screen directly");
        }
        catch (RuntimeException e) {
            Log.w(AlarmScheduler.TAG, "phone in use: couldn't open the ring screen (" + e + "); the notification opens it");
        }
    }

    @Override
    public void showAlarms(Iterable<RingController.Alarm> ringing) {
        List<RingController.Alarm> all = new ArrayList<>();
        for (RingController.Alarm a : ringing) {
            all.add(a);
        }
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(all));
    }

    @Override
    public void acquireWakeLock(long timeoutMs) {
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SomniAI:ring");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(timeoutMs);
    }

    @Override
    public void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    @Override
    public void raiseAlarmVolume(double volumeFactor) {
        AudioManager audio = getSystemService(AudioManager.class);
        int now = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        int min = Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(AudioManager.STREAM_ALARM) : 0;
        int target = RingTuning.streamIndex(now, min, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), volumeFactor);
        // Remembered on disk before the raise, so a reboot mid-ring can't leave it raised.
        AlarmVolume.raise(this, target);
    }

    @Override
    public void restoreAlarmVolume() {
        AlarmVolume.restore(this);
    }

    @Override
    public boolean startSound(RingController.Source source) {
        return sound.start(source);
    }

    @Override
    public void setVolume(float v) {
        volume = v;
        sound.setVolume(v);
    }

    @Override
    public void stopSound() {
        sound.stop();
    }

    @Override
    public void startVibration() {
        if (vibrateAsAlarm(VibrationEffect.createWaveform(new long[] { 0, 800, 600 }, 0))) {
            vibrating = true;
        }
    }

    @Override
    public void pulse() {
        vibrateAsAlarm(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE));
    }

    /** Vibrates with alarm usage, so silent mode and Do Not Disturb treat it as an alarm. */
    private boolean vibrateAsAlarm(VibrationEffect effect) {
        vibrator = Build.VERSION.SDK_INT >= 31
            ? getSystemService(VibratorManager.class).getDefaultVibrator()
            : getSystemService(Vibrator.class);
        if (vibrator == null || !vibrator.hasVibrator()) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        }
        else {
            vibrator.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
        return true;
    }

    @Override
    public void showLevel(EscalationLadder.Level level) {
        Log.i(AlarmScheduler.TAG, "level " + level.level + ": " + level.label);
    }

    @Override
    public void promptChallenge() {
        sendBroadcast(new Intent(ACTION_CHALLENGE).setPackage(getPackageName()));
        // The check can only be answered on the ring screen: make sure it's there.
        openRingScreenIfInUse();
    }

    /**
     * The backup level (3.3): asks the server in the background, which rings
     * the user's other devices and says when people will be told
     * (lib/backupServer.ts). The ring never waits on it; the answer, or
     * "couldn't reach the server", comes back to the controller.
     */
    @Override
    public void requestBackups(RingController.Alarm alarm, List<String> kinds) {
        Context app = getApplicationContext();
        new Thread(() -> {
            String token = SomniMessagingService.ownToken(app, 10_000);
            rememberToken(app, token);
            Outbox.Response r = Outbox.request(app, "/api/alarms/" + alarm.id + "/backups", Backups.request(kinds, token).toString(), 20_000);
            Backups.Answer answer = Backups.fromResponse(kinds, r.status, r.body);
            handler.post(() -> {
                backupNote = Backups.laterLine(answer.later,
                    t -> DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(t)));
                controller.onBackups(answer, System.currentTimeMillis());
                publish();
                sendBroadcast(new Intent(ACTION_BACKUPS).setPackage(getPackageName()));
            });
        }, "somni-backups").start();
    }

    /** The alarm was stopped here after another device was rung: stop it there, through the queue. */
    @Override
    public void stopBackupRing(RingController.Alarm alarm) {
        JSONObject body = new JSONObject();
        // Device-protected, as saved: a stop can come before the first unlock.
        String token = createDeviceProtectedStorageContext().getSharedPreferences(TOKEN_PREFS, MODE_PRIVATE).getString("token", null);
        try {
            if (token != null) {
                body.put("fromToken", token);
            }
        }
        catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        Outbox.enqueue(this, java.util.Collections.singletonList(
            new SyncCalls.Call(alarm.id, "/api/alarms/" + alarm.id + "/backups/stop", body)));
    }

    private static final String TOKEN_PREFS = "somni_push";

    private static void rememberToken(Context context, String token) {
        if (token != null) {
            context.createDeviceProtectedStorageContext().getSharedPreferences(TOKEN_PREFS, MODE_PRIVATE)
                .edit().putString("token", token).apply();
        }
    }

    @Override
    public void stopVibration() {
        if (vibrator != null) {
            vibrator.cancel();
        }
        vibrating = false;
    }

    @Override
    public void scheduleTick(long delayMs) {
        handler.postDelayed(tick, delayMs);
    }

    @Override
    public void cancelTicks() {
        handler.removeCallbacks(tick);
    }

    @Override
    public void closeRingScreen() {
        sendBroadcast(new Intent(ACTION_STOPPED).setPackage(getPackageName()));
    }

    @Override
    public void stopService() {
        current = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        // Not stopSelf(): that stops the service even when another alarm's start
        // is already on its way, and Android then kills the app for not calling
        // startForeground for it (found on the emulator in prompt 2.4). With the
        // latest start id it only stops if nothing newer has arrived.
        stopSelf(latestStartId);
    }

    @Override
    public void record(RingController.Alarm alarm, String outcome, long at, String detail) {
        String context = outcome.equals("ringing") ? detail + "; " + conditions() : detail;
        synchronized (AlarmStore.LOCK) {
            AlarmStore.log(this, AlarmScheduler.logEntry(alarm.id, alarm.label, outcome, alarm.scheduledFor, at, context));
        }
        Log.i(AlarmScheduler.TAG, outcome + " " + alarm.id + ": " + context);
        // The server hears that it rang as it starts, not only once it ends (D-001):
        // queued here, sent when there's a network; the ring never waits for it.
        if (outcome.equals("ringing") && !BackupRing.isBackup(alarm.id)) {
            Outbox.enqueue(this, java.util.Collections.singletonList(SyncCalls.fire(alarm.id, at)));
        }
    }

    @Override
    public void queueSync(RingController.Alarm alarm, long rangAt, String outcome, long endedAt, Verification verification,
            int level, List<Backups.Outcome> backups) {
        if (BackupRing.isBackup(alarm.id)) {
            // Another device's alarm rang here: that device reports its ring, not this one.
            return;
        }
        // The fire went when the ring started (record, above); this is how it ended.
        Outbox.enqueue(this, SyncCalls.afterFire(alarm.id, rangAt, outcome, endedAt, verification, level, backups));
        JSONObject wake = Telemetry.get(this).ringEnded(alarm.id, outcome, endedAt, SystemClock.elapsedRealtime(), level,
            alarm.ladder.stageOf(level), verification, alarm.check.required);
        if (wake != null) {
            Telemetry.send(this, wake);
        }
    }

    @Override
    public void snooze(RingController.Alarm alarm, long until) {
        if (!BackupRing.isBackup(alarm.id)) {
            AlarmScheduler.snooze(this, alarm.id, until);
        }
    }

    // --- Helpers ---

    /** What could keep it from being heard, recorded with each ring. */
    private String conditions() {
        AudioManager audio = getSystemService(AudioManager.class);
        NotificationManager nm = getSystemService(NotificationManager.class);
        String fsi = Build.VERSION.SDK_INT >= 34 ? (nm.canUseFullScreenIntent() ? "allowed" : "NOT allowed") : "allowed";
        return "alarm volume " + audio.getStreamVolume(AudioManager.STREAM_ALARM) + "/" + audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            + ", ringer " + ringerMode(audio.getRingerMode())
            + ", do not disturb " + interruptionFilter(nm.getCurrentInterruptionFilter())
            + ", full-screen " + fsi;
    }

    private static String ringerMode(int mode) {
        return mode == AudioManager.RINGER_MODE_SILENT ? "silent" : mode == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "normal";
    }

    private static String interruptionFilter(int filter) {
        switch (filter) {
            case NotificationManager.INTERRUPTION_FILTER_PRIORITY:
                return "priority only";
            case NotificationManager.INTERRUPTION_FILTER_ALARMS:
                return "alarms only";
            case NotificationManager.INTERRUPTION_FILTER_NONE:
                return "TOTAL SILENCE (Android mutes alarms)";
            default:
                return "off";
        }
    }

    private Notification notification(List<RingController.Alarm> alarms) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Ringing alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("An alarm going off. Its sound and vibration come from the alarm itself.");
        // The service plays the sound and vibrates; the channel must not add its own.
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);

        RingController.Alarm first = alarms.get(0);
        PendingIntent screen = PendingIntent.getActivity(this, 0,
            new Intent(this, RingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Tapping the notification (the screen was on, so it showed as a banner) is the user's
        // first interaction: a separate intent, so the full-screen launch, which is no one's doing, isn't.
        PendingIntent tapped = PendingIntent.getActivity(this, 1,
            new Intent(this, RingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(EXTRA_VIA, "notification"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(first.scheduledFor));
        String title = first.label.isEmpty() ? "Alarm" : first.label;
        if (alarms.size() > 1) {
            title += " and " + (alarms.size() - 1) + " more";
        }
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(time + ". Tap to stop.")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setFullScreenIntent(screen, true)
            .setContentIntent(tapped)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void publish() {
        if (controller.state() != RingController.State.RINGING) {
            current = null;
            return;
        }
        List<String> ids = new ArrayList<>();
        RingController.Alarm first = null;
        for (RingController.Alarm a : controller.ringing()) {
            ids.add(a.id);
            if (first == null) {
                first = a;
            }
        }
        current = new Snapshot(ids, first == null ? "" : first.label, first == null ? 0 : first.scheduledFor,
            controller.source(), volume, vibrating, wakeLock != null && wakeLock.isHeld(), controller.check(), controller.level(),
            controller.canSnooze() && first != null && !BackupRing.isBackup(first.id));
    }
}
