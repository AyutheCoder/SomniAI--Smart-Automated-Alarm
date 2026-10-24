package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The native wake check on the ring screen: wrong answers keep it ringing, a
 * right one stops it, and the result is queued for the server. No web view and
 * no network are involved.
 *
 * It drives whichever ring screen is open. Before Android 10 the alarm's
 * full-screen intent opens it at once even with the screen on; later versions
 * show a heads-up instead, and the test opens it as tapping that would. Taps
 * go to the views directly: whether a user can reach Check above the keyboard
 * is its own test.
 */
@RunWith(AndroidJUnit4.class)
public class RingActivityTest {

    private Instrumentation instrumentation;
    private Context context;
    private long startedAt;

    @Before
    public void setUp() {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        context = instrumentation.getTargetContext();
        startedAt = System.currentTimeMillis();
    }

    @After
    public void tearDown() throws Exception {
        if (RingService.current != null) {
            RingService.dismiss(context, new Verification(true, true, 1, 1_000, 0,
                java.util.Collections.nCopies(10, "math"), 100, System.currentTimeMillis()));
            waitFor("stopped", () -> RingService.current == null);
        }
        waitFor("ring screen closed", () -> ringScreen() == null);
    }

    @Test
    public void wrongAnswersKeepItRingingAndTheRightOneStopsIt() throws Exception {
        RingActivity screen = ring("t-screen", "{\"required\":true,\"methods\":[\"math\"],\"minConfidence\":60}");
        tap(screen, "Stop alarm");
        waitFor("the check", () -> findText(screen, "Solve to stop the alarm") != null);

        for (int i = 0; i < 3; i++) {
            answer(screen, problemAnswer(screen) + 1);
            assertTrue(messageOf(screen).startsWith("Not quite"));
            assertNotNull("a wrong answer never stops it", RingService.current);
        }
        answer(screen, -5);
        answer(screen, Integer.MAX_VALUE);
        assertNotNull(RingService.current);

        answer(screen, problemAnswer(screen));
        waitFor("stopped", () -> RingService.current == null);
        assertEquals("dismissed", lastOutcome("t-screen"));

        // Queued for the server: fire, verify (solved, 5 wrong answers), dismiss.
        List<JSONObject> calls = queued("t-screen");
        assertEquals(3, calls.size());
        assertTrue(calls.get(0).getString("path").endsWith("/fire"));
        assertTrue(calls.get(1).getString("path").endsWith("/verify"));
        JSONObject verify = new JSONObject(calls.get(1).getString("body"));
        assertTrue(verify.getBoolean("solved"));
        assertEquals(5, verify.getInt("attempts"));
        assertTrue(calls.get(2).getString("path").endsWith("/dismiss"));
    }

    /**
     * Found on the emulator: drawn edge to edge, the screen didn't shrink for the
     * keyboard, and the keyboard covered Check.
     */
    @Test
    public void theKeyboardOpensByItselfAndNeverCoversCheck() throws Exception {
        RingActivity screen = ring("t-keyboard", "{\"required\":true,\"methods\":[\"math\"],\"minConfidence\":60}");
        // A real touch, as a user's: Android opens the keyboard by itself only after one.
        touch(screen, "Stop alarm");
        final int[] imeBottom = new int[1];
        long end = System.currentTimeMillis() + 5_000;
        while (imeBottom[0] == 0 && System.currentTimeMillis() < end) {
            instrumentation.runOnMainSync(() -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(screen.getWindow().getDecorView());
                imeBottom[0] = insets == null ? 0 : insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            });
            Thread.sleep(100);
        }
        Assume.assumeTrue("no soft keyboard reported on this image", imeBottom[0] > 0);
        final int[] gap = new int[1];
        instrumentation.runOnMainSync(() -> {
            View check = findDesc(screen, "Check");
            int[] at = new int[2];
            check.getLocationInWindow(at);
            int keyboardTop = screen.getWindow().getDecorView().getHeight() - imeBottom[0];
            gap[0] = keyboardTop - (at[1] + check.getHeight());
        });
        assertTrue("Check ends " + (-gap[0]) + " px under the keyboard", gap[0] >= 0);
    }

    @Test
    public void withNoCheckInThePlanStopStopsAtOnce() throws Exception {
        RingActivity screen = ring("t-nocheck", "{\"required\":false,\"methods\":[\"math\"],\"minConfidence\":70}");
        tap(screen, "Stop alarm");
        waitFor("stopped", () -> RingService.current == null);
        assertEquals("dismissed", lastOutcome("t-nocheck"));
    }

    // --- helpers ---

    /** Starts a ring and returns its ring screen, opening it if the system didn't. */
    private RingActivity ring(String id, String challenge) throws Exception {
        String plan = "{\"version\":1,\"sound\":{\"intensity\":50,\"strategy\":\"gentle\"},\"challenge\":" + challenge + "}";
        AlarmSpec spec = new AlarmSpec(id, "Screen test", 7, 0, EnumSet.noneOf(DayOfWeek.class), LocalDate.now(), true, plan);
        assertTrue(RingService.start(context, spec, System.currentTimeMillis()));
        waitFor("ringing", () -> RingService.current != null);
        long end = System.currentTimeMillis() + 3_000;
        while (ringScreen() == null && System.currentTimeMillis() < end) {
            Thread.sleep(100);
        }
        if (ringScreen() == null) {
            context.startActivity(new Intent(context, RingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        waitFor("ring screen open", () -> ringScreen() != null);
        RingActivity screen = ringScreen();
        waitFor("Stop shown", () -> findText(screen, "Stop alarm") != null);
        return screen;
    }

    private RingActivity ringScreen() {
        final RingActivity[] found = new RingActivity[1];
        instrumentation.runOnMainSync(() -> {
            for (Activity a : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                if (a instanceof RingActivity) {
                    found[0] = (RingActivity) a;
                }
            }
        });
        return found[0];
    }

    private void tap(RingActivity screen, String label) {
        instrumentation.runOnMainSync(() -> findDesc(screen, label).performClick());
        instrumentation.waitForIdleSync();
    }

    /**
     * A real tap at the view's centre. Where a system window lies over the
     * screen (the alarm's heads-up on older Android), Android refuses to deliver
     * it to another app's window, and the test can't continue.
     */
    private void touch(RingActivity screen, String label) {
        final int[] xy = new int[2];
        final int[] size = new int[2];
        instrumentation.runOnMainSync(() -> {
            View v = findDesc(screen, label);
            v.getLocationOnScreen(xy);
            size[0] = v.getWidth();
            size[1] = v.getHeight();
        });
        float x = xy[0] + size[0] / 2f;
        float y = xy[1] + size[1] / 2f;
        long t = android.os.SystemClock.uptimeMillis();
        try {
            instrumentation.sendPointerSync(android.view.MotionEvent.obtain(t, t, android.view.MotionEvent.ACTION_DOWN, x, y, 0));
            instrumentation.sendPointerSync(android.view.MotionEvent.obtain(t, t + 50, android.view.MotionEvent.ACTION_UP, x, y, 0));
        }
        catch (SecurityException | IllegalArgumentException e) {
            // SecurityException up to Android 13, IllegalArgumentException later.
            Assume.assumeTrue("a system window lies over the ring screen here: " + e.getMessage(), false);
        }
        instrumentation.waitForIdleSync();
    }

    private void answer(RingActivity screen, long value) {
        instrumentation.runOnMainSync(() -> {
            EditText field = (EditText) findDesc(screen, "Answer");
            field.setText(String.valueOf(value));
            // As the keyboard's Done key does.
            field.onEditorAction(EditorInfo.IME_ACTION_DONE);
        });
        instrumentation.waitForIdleSync();
    }

    /** Reads the problem on screen ("7 × 9 = ?") and works out its answer. */
    private int problemAnswer(RingActivity screen) {
        final String[] q = new String[1];
        instrumentation.runOnMainSync(() -> q[0] = ((TextView) findDesc(screen, "Problem")).getText().toString());
        String[] ab = q[0].replace(" = ?", "").split(" × ");
        return Integer.parseInt(ab[0]) * Integer.parseInt(ab[1]);
    }

    private String messageOf(RingActivity screen) {
        final String[] m = new String[1];
        instrumentation.runOnMainSync(() -> {
            View v = findTextView(screen, "Not quite");
            m[0] = v == null ? "" : ((TextView) v).getText().toString();
        });
        return m[0];
    }

    private static View findDesc(Activity a, String desc) {
        ArrayList<View> found = new ArrayList<>();
        a.getWindow().getDecorView().findViewsWithText(found, desc, View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION);
        return found.isEmpty() ? null : found.get(0);
    }

    private static View findTextView(Activity a, String text) {
        ArrayList<View> found = new ArrayList<>();
        a.getWindow().getDecorView().findViewsWithText(found, text, View.FIND_VIEWS_WITH_TEXT);
        return found.isEmpty() ? null : found.get(0);
    }

    private View findText(Activity a, String text) {
        final View[] v = new View[1];
        instrumentation.runOnMainSync(() -> v[0] = findTextView(a, text));
        return v[0];
    }

    private String lastOutcome(String id) throws Exception {
        String last = null;
        JSONArray log = AlarmStore.readLog(context);
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.getJSONObject(i);
            if (e.getString("id").equals(id) && e.optLong("at", 0) >= startedAt) {
                last = e.getString("outcome");
            }
        }
        return last;
    }

    private List<JSONObject> queued(String id) throws Exception {
        List<JSONObject> out = new ArrayList<>();
        JSONArray pending = Outbox.queue(context).pending();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject e = pending.getJSONObject(i);
            if (e.getString("alarmId").equals(id) && e.getLong("queuedAt") >= startedAt) {
                out.add(e);
            }
        }
        return out;
    }

    private static void waitFor(String what, BooleanSupplier c) throws InterruptedException {
        long end = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < end) {
            if (c.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("timed out waiting for: " + what);
    }
}
