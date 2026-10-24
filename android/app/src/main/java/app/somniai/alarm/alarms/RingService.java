package app.somniai.alarm.alarms;

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
    /** Sent (to this app only) when ringing ends, so the ring screen closes. */
    static final String ACTION_STOPPED = "app.somniai.alarm.RING_STOPPED";
    static final String CHANNEL = "ringing";
    private static final int NOTIFICATION_ID = 7001;
    private static final String EXTRA_ID = "id";
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_AT = "at";
    private static final String EXTRA_PLAN = "plan";

    /**
     * What is ringing now, for the ring screen and the on-device tests. Null
     * when nothing is. Published only between steps (after a start or a ramp
     * tick has finished), never halfway through one.
     */
    static volatile Snapshot current;

    static final class Snapshot {
        final List<String> ids;
        final String label;
        final long scheduledFor;
        final RingController.Source source;
        final float volume;
        final boolean vibrating;
        final boolean wakeLockHeld;

        Snapshot(List<String> ids, String label, long scheduledFor, RingController.Source source, float volume, boolean vibrating, boolean wakeLockHeld) {
            this.ids = ids;
            this.label = label;
            this.scheduledFor = scheduledFor;
            this.source = source;
            this.volume = volume;
            this.vibrating = vibrating;
            this.wakeLockHeld = wakeLockHeld;
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

    /** Stops whatever is ringing. Does nothing if nothing is. */
    static void dismiss(Context context) {
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_DISMISS));
        }
        catch (IllegalStateException e) {
            // The app is in the background, so no ring service is running: nothing to stop.
            Log.i(AlarmScheduler.TAG, "dismiss with nothing ringing");
        }
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private RingController controller;
    private final Runnable tick = () -> {
        controller.tick(System.currentTimeMillis());
        publish();
    };
    private AlarmSound sound;
    private PowerManager.WakeLock wakeLock;
    private Vibrator vibrator;
    private boolean vibrating;
    private float volume;
    /** The alarm stream index before it was raised, or -1 if it wasn't. */
    private int restoreIndex = -1;
    private int raisedTo = -1;

    @Override
    public void onCreate() {
        super.onCreate();
        controller = new RingController(this);
        sound = new AlarmSound(this, () -> handler.post(() -> controller.soundFailed(System.currentTimeMillis())));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        long now = System.currentTimeMillis();
        if (ACTION_RING.equals(action)) {
            RingController.Alarm alarm = new RingController.Alarm(
                String.valueOf(intent.getStringExtra(EXTRA_ID)),
                String.valueOf(intent.getStringExtra(EXTRA_LABEL)),
                intent.getLongExtra(EXTRA_AT, now));
            controller.start(alarm, RingTuning.fromPlan(intent.getStringExtra(EXTRA_PLAN)), now);
        }
        else if (ACTION_DISMISS.equals(action)) {
            controller.dismiss(now);
        }
        if (controller.state() != RingController.State.RINGING) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        publish();
        // If Android kills the process mid-ring, deliver the ring again rather than fall silent.
        return START_REDELIVER_INTENT;
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
        Notification n = notification(one);
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
    public void raiseAlarmVolume() {
        AudioManager audio = getSystemService(AudioManager.class);
        int now = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        int min = Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(AudioManager.STREAM_ALARM) : 0;
        int target = RingTuning.streamIndex(now, min, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        if (target > now) {
            try {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, target, 0);
                restoreIndex = now;
                raisedTo = target;
                Log.i(AlarmScheduler.TAG, "alarm volume raised from " + now + " to " + target + " while ringing");
            }
            catch (SecurityException e) {
                Log.w(AlarmScheduler.TAG, "could not raise the alarm volume: " + e);
            }
        }
    }

    @Override
    public void restoreAlarmVolume() {
        if (restoreIndex < 0) {
            return;
        }
        AudioManager audio = getSystemService(AudioManager.class);
        // Only put it back if the user hasn't changed it meanwhile.
        if (audio.getStreamVolume(AudioManager.STREAM_ALARM) == raisedTo) {
            try {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, restoreIndex, 0);
            }
            catch (SecurityException e) {
                Log.w(AlarmScheduler.TAG, "could not restore the alarm volume: " + e);
            }
        }
        restoreIndex = -1;
        raisedTo = -1;
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
        vibrator = Build.VERSION.SDK_INT >= 31
            ? getSystemService(VibratorManager.class).getDefaultVibrator()
            : getSystemService(Vibrator.class);
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }
        VibrationEffect effect = VibrationEffect.createWaveform(new long[] { 0, 800, 600 }, 0);
        if (Build.VERSION.SDK_INT >= 33) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        }
        else {
            vibrator.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
        vibrating = true;
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
        stopSelf();
    }

    @Override
    public void record(RingController.Alarm alarm, String outcome, long at, String detail) {
        String context = outcome.equals("ringing") ? detail + "; " + conditions() : detail;
        synchronized (AlarmStore.LOCK) {
            AlarmStore.log(this, AlarmScheduler.logEntry(alarm.id, alarm.label, outcome, alarm.scheduledFor, at, context));
        }
        Log.i(AlarmScheduler.TAG, outcome + " " + alarm.id + ": " + context);
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
            .setContentIntent(screen)
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
            controller.source(), volume, vibrating, wakeLock != null && wakeLock.isHeld());
    }
}
