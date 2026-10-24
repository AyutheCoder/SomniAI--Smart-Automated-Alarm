package app.somniai.alarm.alarms;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.action.ViewActions.closeSoftKeyboard;
import static androidx.test.espresso.action.ViewActions.replaceText;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.withContentDescription;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.view.View;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The native wake check on the ring screen, driven as a user would: wrong
 * answers keep it ringing, a right one stops it, and the result is queued for
 * the server. No web view and no network are involved.
 */
@RunWith(AndroidJUnit4.class)
public class RingActivityTest {

    private Context context;
    private long startedAt;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        startedAt = System.currentTimeMillis();
    }

    @After
    public void tearDown() throws Exception {
        if (RingService.current != null) {
            RingService.dismiss(context, new Verification(true, true, 1, 1_000, 0,
                java.util.Collections.nCopies(10, "math"), 100, System.currentTimeMillis()));
            waitFor(() -> RingService.current == null);
        }
    }

    @Test
    public void wrongAnswersKeepItRingingAndTheRightOneStopsIt() throws Exception {
        ring("t-screen", "{\"required\":true,\"methods\":[\"math\"],\"minConfidence\":60}");
        try (ActivityScenario<RingActivity> screen = ActivityScenario.launch(RingActivity.class)) {
            onView(withText("Stop alarm")).perform(click());
            onView(withText("Solve to stop the alarm")).check(matches(withText("Solve to stop the alarm")));

            for (int i = 0; i < 3; i++) {
                answer(screen, problemAnswer(screen) + 1);
                onView(withText(containsString("Not quite"))).check(matches(withText(containsString("Not quite"))));
                assertNotNull("a wrong answer never stops it", RingService.current);
            }
            answer(screen, -5);
            answer(screen, Integer.MAX_VALUE);
            assertNotNull(RingService.current);

            answer(screen, problemAnswer(screen));
            waitFor(() -> RingService.current == null);
        }
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
        ring("t-keyboard", "{\"required\":true,\"methods\":[\"math\"],\"minConfidence\":60}");
        try (ActivityScenario<RingActivity> screen = ActivityScenario.launch(RingActivity.class)) {
            onView(withText("Stop alarm")).perform(click());
            final int[] imeBottom = new int[1];
            long end = System.currentTimeMillis() + 5_000;
            while (imeBottom[0] == 0 && System.currentTimeMillis() < end) {
                screen.onActivity(a -> {
                    androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(a.getWindow().getDecorView());
                    imeBottom[0] = insets == null ? 0 : insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()).bottom;
                });
                Thread.sleep(100);
            }
            org.junit.Assume.assumeTrue("this image shows no soft keyboard (hardware keyboard emulated)", imeBottom[0] > 0);
            final int[] gap = new int[1];
            screen.onActivity(a -> {
                ArrayList<View> found = new ArrayList<>();
                a.getWindow().getDecorView().findViewsWithText(found, "Check", View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION);
                int[] at = new int[2];
                found.get(0).getLocationInWindow(at);
                int checkBottom = at[1] + found.get(0).getHeight();
                int keyboardTop = a.getWindow().getDecorView().getHeight() - imeBottom[0];
                gap[0] = keyboardTop - checkBottom;
            });
            assertTrue("Check ends " + (-gap[0]) + " px under the keyboard", gap[0] >= 0);
        }
    }

    @Test
    public void withNoCheckInThePlanStopStopsAtOnce() throws Exception {
        ring("t-nocheck", "{\"required\":false,\"methods\":[\"math\"],\"minConfidence\":70}");
        try (ActivityScenario<RingActivity> screen = ActivityScenario.launch(RingActivity.class)) {
            onView(withText("Stop alarm")).perform(click());
            waitFor(() -> RingService.current == null);
        }
        assertNull(RingService.current);
        assertEquals("dismissed", lastOutcome("t-nocheck"));
    }

    // --- helpers ---

    private void ring(String id, String challenge) throws Exception {
        String plan = "{\"version\":1,\"sound\":{\"intensity\":50,\"strategy\":\"gentle\"},\"challenge\":" + challenge + "}";
        AlarmSpec spec = new AlarmSpec(id, "Screen test", 7, 0, EnumSet.noneOf(DayOfWeek.class), LocalDate.now(), true, plan);
        assertTrue(RingService.start(context, spec, System.currentTimeMillis()));
        waitFor(() -> RingService.current != null);
    }

    /** Reads the problem on screen ("7 × 9 = ?") and works out its answer. */
    private static int problemAnswer(ActivityScenario<RingActivity> screen) {
        final String[] q = new String[1];
        screen.onActivity(a -> {
            ArrayList<View> found = new ArrayList<>();
            a.getWindow().getDecorView().findViewsWithText(found, "Problem", View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION);
            q[0] = ((TextView) found.get(0)).getText().toString();
        });
        String[] ab = q[0].replace(" = ?", "").split(" × ");
        return Integer.parseInt(ab[0]) * Integer.parseInt(ab[1]);
    }

    private static void answer(ActivityScenario<RingActivity> screen, long value) {
        onView(withContentDescription("Answer")).perform(replaceText(String.valueOf(value)), closeSoftKeyboard());
        onView(withText("Check")).perform(click());
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

    private static void waitFor(java.util.function.BooleanSupplier c) throws InterruptedException {
        long end = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < end) {
            if (c.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("timed out");
    }
}
