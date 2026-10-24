package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.Vibrator;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.io.IOException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The real ring service on a real Android: foreground with a full-screen
 * alarm notification, playing on the alarm stream, holding a wake lock,
 * ramping up, ringing in silent mode and with Do Not Disturb on, and leaving
 * nothing behind when dismissed. Runs on the CI emulators (API 26, 32, 35)
 * and locally with scripts/android-instrument.sh.
 *
 * What a test can't observe (sound coming out of a speaker, the screen
 * turning on over a locked phone) is on the device checklist in DEVICE_TESTS.md.
 */
@RunWith(AndroidJUnit4.class)
public class RingServiceTest {

    private static final int NOTIFICATION_ID = 7001;
    private Context context;
    private final List<String> restore = new ArrayList<>();
    /** The log outlives a test run; only entries written after this count. */
    private long startedAt;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= 33) {
            shell("pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        }
        stopAnyRing();
        startedAt = System.currentTimeMillis();
    }

    @After
    public void tearDown() throws Exception {
        stopAnyRing();
        for (String cmd : restore) {
            shell(cmd);
        }
    }

    @Test
    public void ringsInTheForegroundOnTheAlarmStreamAndStopsCleanly() throws Exception {
        long scheduledFor = System.currentTimeMillis();
        assertTrue(RingService.start(context, spec("t-basic"), scheduledFor));
        waitFor("ringing", () -> RingService.current != null);
        waitFor("playing on the alarm stream", this::alarmPlaying);

        RingService.Snapshot s = RingService.current;
        assertTrue("wake lock held", s.wakeLockHeld);
        assertNotNull("a sound source played", s.source);
        Vibrator v = context.getSystemService(Vibrator.class);
        assertEquals("vibrates when the device can", v != null && v.hasVibrator(), s.vibrating);

        Notification n = ringNotification();
        assertNotNull("ring notification posted", n);
        assertEquals(Notification.CATEGORY_ALARM, n.category);
        assertNotNull("full-screen intent to the ring screen", n.fullScreenIntent);
        assertTrue("the service is in the foreground", (n.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
        assertEquals(NotificationManager.IMPORTANCE_HIGH,
            context.getSystemService(NotificationManager.class).getNotificationChannel(RingService.CHANNEL).getImportance());

        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        waitFor("stopped", () -> RingService.current == null && ringNotification() == null && !alarmPlaying());
        assertEquals(List.of("ringing", "dismissed"), outcomesFor("t-basic"));
    }

    @Test
    public void theVolumeRampsUp() throws Exception {
        assertTrue(RingService.start(context, spec("t-ramp"), System.currentTimeMillis()));
        waitFor("ringing", () -> RingService.current != null);
        float first = RingService.current.volume;
        Thread.sleep(3_000);
        float later = RingService.current.volume;
        assertTrue("louder after 3 s: " + first + " -> " + later, later > first * 2);
    }

    @Test
    public void ringsInSilentModeWithDoNotDisturbOn() throws Exception {
        AudioManager audio = context.getSystemService(AudioManager.class);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        shell("cmd audio set-ringer-mode SILENT");
        restore.add("cmd audio set-ringer-mode NORMAL");
        shell("cmd notification set_dnd priority");
        restore.add("cmd notification set_dnd off");
        waitFor("silent and priority-only", () -> audio.getRingerMode() == AudioManager.RINGER_MODE_SILENT
            && nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_PRIORITY, 5_000, false);
        assumeTrue("this image's shell can't set the ringer mode and Do Not Disturb",
            audio.getRingerMode() == AudioManager.RINGER_MODE_SILENT
                && nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_PRIORITY);

        assertTrue(RingService.start(context, spec("t-silent"), System.currentTimeMillis()));
        waitFor("ringing", () -> RingService.current != null);
        waitFor("playing on the alarm stream", this::alarmPlaying);
        assertFalse("silent mode doesn't mute the alarm stream", audio.isStreamMute(AudioManager.STREAM_ALARM));
        assertTrue(audio.getStreamVolume(AudioManager.STREAM_ALARM) > 0);
        assertNotNull(ringNotification());
        String detail = lastDetail("t-silent", "ringing");
        assertTrue(detail, detail.contains("ringer silent"));
        assertTrue(detail, detail.contains("do not disturb priority only"));
    }

    @Test
    public void aTurnedDownAlarmVolumeIsRaisedWhileRingingAndRestoredAfter() throws Exception {
        AudioManager audio = context.getSystemService(AudioManager.class);
        int before = audio.getStreamVolume(AudioManager.STREAM_ALARM);
        int min = Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(AudioManager.STREAM_ALARM) : 0;
        try {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, min, 0);
            int floor = RingTuning.streamIndex(min, min, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));

            assertTrue(RingService.start(context, spec("t-volume"), System.currentTimeMillis()));
            waitFor("ringing", () -> RingService.current != null);
            assertEquals("raised to the floor", floor, audio.getStreamVolume(AudioManager.STREAM_ALARM));
            RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
            waitFor("stopped", () -> RingService.current == null);
            assertEquals("restored", min, audio.getStreamVolume(AudioManager.STREAM_ALARM));
        }
        finally {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, before, 0);
        }
    }

    @Test
    public void aSecondAlarmJoinsAndOneDismissalStopsBoth() throws Exception {
        long now = System.currentTimeMillis();
        assertTrue(RingService.start(context, spec("t-first"), now));
        waitFor("first ringing", () -> RingService.current != null);
        assertTrue(RingService.start(context, spec("t-second"), now));
        waitFor("both ringing", () -> RingService.current != null && RingService.current.ids.size() == 2);
        // Past Android's deadline for startForeground after the second start: the
        // app used to be killed here (ForegroundServiceDidNotStartInTimeException).
        Thread.sleep(12_000);
        assertNotNull("still alive and ringing", RingService.current);
        assertTrue(alarmPlaying());
        // The same alarm delivered again (a redelivered intent) must not kill it either.
        assertTrue(RingService.start(context, spec("t-second"), now));
        Thread.sleep(12_000);
        assertNotNull("still alive after a repeat start", RingService.current);
        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        waitFor("stopped", () -> RingService.current == null && ringNotification() == null);
        assertEquals(List.of("ringing", "dismissed"), outcomesFor("t-first"));
        assertEquals(List.of("ringing", "dismissed"), outcomesFor("t-second"));
    }

    @Test
    public void aRingThatNeedsAWakeCheckStopsOnlyWithAPassedOne() throws Exception {
        assertTrue(RingService.start(context, spec("t-gate", "{\"required\":true,\"methods\":[\"math\"],\"minConfidence\":60}"), System.currentTimeMillis()));
        waitFor("ringing", () -> RingService.current != null);
        assertTrue(RingService.current.check.required);

        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        RingService.dismiss(context, null);
        RingService.dismiss(context, new Verification(true, false, 0, 3_000, 4, List.of("math"), 99, System.currentTimeMillis()));
        waitFor("three refusals logged", () -> {
            try {
                return outcomesFor("t-gate").stream().filter(o -> o.equals("dismiss_refused")).count() == 3;
            }
            catch (Exception e) {
                return false;
            }
        });
        assertNotNull("still ringing", RingService.current);
        assertTrue(alarmPlaying());

        // A real check, solved quickly, stops it.
        WakeCheck check = new WakeCheck(RingService.current.check, new java.util.Random(1), System.currentTimeMillis());
        String[] ab = check.question().split(" × ");
        assertEquals(WakeCheck.Step.PASSED, check.submit(String.valueOf(Integer.parseInt(ab[0]) * Integer.parseInt(ab[1])), System.currentTimeMillis() + 3_000));
        RingService.dismiss(context, check.verification(System.currentTimeMillis()));
        waitFor("stopped", () -> RingService.current == null && !alarmPlaying());
        assertEquals("dismissed", outcomesFor("t-gate").get(outcomesFor("t-gate").size() - 1));
    }

    @Test
    public void aStoppedRingIsQueuedForTheServer() throws Exception {
        assertTrue(RingService.start(context, spec("t-queue"), System.currentTimeMillis()));
        waitFor("ringing", () -> RingService.current != null);
        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        waitFor("stopped", () -> RingService.current == null);
        List<String> paths = new ArrayList<>();
        JSONArray pending = Outbox.queue(context).pending();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject e = pending.getJSONObject(i);
            if (e.getString("alarmId").equals("t-queue") && e.getLong("queuedAt") >= startedAt) {
                paths.add(e.getString("path"));
            }
        }
        assertEquals(List.of("/api/alarms/t-queue/fire", "/api/alarms/t-queue/dismiss"), paths);
    }

    /**
     * Found on the emulator in prompt 2.4: an alarm going off just as another is
     * dismissed. The stopping service was torn down under the new start, and the
     * app was killed (ForegroundServiceDidNotStartInTimeException).
     */
    @Test
    public void anAlarmGoingOffJustAsAnotherIsDismissedStillRings() throws Exception {
        assertTrue(RingService.start(context, spec("t-race-1"), System.currentTimeMillis()));
        waitFor("first ringing", () -> RingService.current != null);
        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        assertTrue(RingService.start(context, spec("t-race-2"), System.currentTimeMillis()));
        waitFor("second ringing", () -> RingService.current != null && RingService.current.ids.contains("t-race-2"));
        Thread.sleep(12_000);
        assertNotNull("still alive and ringing", RingService.current);
        assertTrue(alarmPlaying());
        assertEquals(List.of("ringing", "dismissed"), outcomesFor("t-race-1"));
    }

    @Test
    public void dismissWithNothingRingingIsHarmless() throws Exception {
        RingService.dismiss(context, Verification.none(System.currentTimeMillis()));
        Thread.sleep(1_000);
        assertEquals(null, RingService.current);
        assertEquals(null, ringNotification());
    }

    // --- helpers ---

    /** A ring plan with no wake check, so the lifecycle tests can stop it directly. */
    private AlarmSpec spec(String id) {
        return spec(id, "{\"required\":false,\"methods\":[\"math\"],\"minConfidence\":70}");
    }

    private AlarmSpec spec(String id, String challenge) {
        String plan = "{\"version\":1,\"sound\":{\"intensity\":80,\"strategy\":\"aggressive\"},\"challenge\":" + challenge + "}";
        return new AlarmSpec(id, "Test " + id, 7, 0, EnumSet.noneOf(DayOfWeek.class), LocalDate.now(), true, plan);
    }

    /** Stops a ring left by a failed test, with a check that passes any plan. */
    private void stopAnyRing() throws Exception {
        if (RingService.current != null) {
            RingService.dismiss(context, new Verification(true, true, 1, 1_000, 0,
                java.util.Collections.nCopies(10, "math"), 100, System.currentTimeMillis()));
            waitFor("previous ring stopped", () -> RingService.current == null);
        }
    }

    private boolean alarmPlaying() {
        for (AudioPlaybackConfiguration c : context.getSystemService(AudioManager.class).getActivePlaybackConfigurations()) {
            if (c.getAudioAttributes().getUsage() == AudioAttributes.USAGE_ALARM) {
                return true;
            }
        }
        return false;
    }

    private Notification ringNotification() {
        for (StatusBarNotification sbn : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            if (sbn.getId() == NOTIFICATION_ID) {
                return sbn.getNotification();
            }
        }
        return null;
    }

    private List<String> outcomesFor(String id) throws Exception {
        List<String> out = new ArrayList<>();
        JSONArray log = AlarmStore.readLog(context);
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.getJSONObject(i);
            if (e.getString("id").equals(id) && e.optLong("at", 0) >= startedAt) {
                out.add(e.getString("outcome"));
            }
        }
        return out;
    }

    private String lastDetail(String id, String outcome) throws Exception {
        JSONArray log = AlarmStore.readLog(context);
        for (int i = log.length() - 1; i >= 0; i--) {
            JSONObject e = log.getJSONObject(i);
            if (e.getString("id").equals(id) && e.getString("outcome").equals(outcome)) {
                return e.getString("detail");
            }
        }
        return "";
    }

    private static void waitFor(String what, BooleanSupplier condition) throws InterruptedException {
        waitFor(what, condition, 15_000, true);
    }

    private static void waitFor(String what, BooleanSupplier condition, long timeoutMs, boolean required) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            if (condition.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        if (required) {
            throw new AssertionError("timed out waiting for: " + what);
        }
    }

    private static String shell(String command) throws IOException {
        ParcelFileDescriptor pfd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        StringBuilder out = new StringBuilder();
        try (FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.append(new String(buf, 0, n));
            }
        }
        return out.toString();
    }
}
