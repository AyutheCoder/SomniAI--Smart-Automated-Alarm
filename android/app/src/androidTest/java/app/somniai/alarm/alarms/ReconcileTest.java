package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.AlarmManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Reconcile on a device, against the real store and AlarmManager, read back
 * through AlarmManager.getNextAlarmClock(): the system's own view of which
 * alarm rings next, and whose it is.
 */
@RunWith(AndroidJUnit4.class)
public class ReconcileTest {

    static final String A = "aaaaaaaaaaaaaaaaaaaaaaaa";
    static final String B = "bbbbbbbbbbbbbbbbbbbbbbbb";

    private Context context;
    private AlarmManager alarms;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        alarms = context.getSystemService(AlarmManager.class);
        clear();
    }

    @After
    public void tearDown() {
        clear();
    }

    /** Starts from no alarms of this app's, debug ones included. */
    private void clear() {
        AlarmScheduler.reconcile(context, List.of());
        for (AlarmRecord r : AlarmScheduler.list(context)) {
            AlarmScheduler.remove(context, r.spec.id);
        }
    }

    /** A one-off {@code minutes} from now, so it is the next alarm clock. */
    private AlarmSpec inMinutes(String id, int minutes) {
        LocalDateTime t = LocalDateTime.now(ZoneId.systemDefault()).plusMinutes(minutes);
        return new AlarmSpec(id, "Reconcile test", t.getHour(), t.getMinute(), EnumSet.noneOf(DayOfWeek.class), t.toLocalDate(), true, null);
    }

    /** The trigger time of the next alarm clock, if it is this app's; null otherwise. */
    private Long ourNextAlarm() {
        AlarmManager.AlarmClockInfo next = alarms.getNextAlarmClock();
        if (next == null || next.getShowIntent() == null || !context.getPackageName().equals(next.getShowIntent().getCreatorPackage())) {
            return null;
        }
        return next.getTriggerTime();
    }

    private AlarmRecord stored(String id) {
        for (AlarmRecord r : AlarmScheduler.list(context)) {
            if (r.spec.id.equals(id)) {
                return r;
            }
        }
        return null;
    }

    @Test
    public void createEditDisableAndDeleteReachAlarmManager() {
        AlarmSpec a = inMinutes(A, 30);
        ReconcilePlan p = AlarmScheduler.reconcile(context, List.of(a));
        assertEquals(1, p.put.size());
        Long first = ourNextAlarm();
        assertNotNull("created: AlarmManager has it", first);
        assertEquals(stored(A).triggerAt, first);

        // Edited to 20 minutes from now: it moves.
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 20)));
        assertTrue("edited: earlier now", ourNextAlarm() < first);

        // Turned off: kept, not scheduled.
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 20).withEnabled(false)));
        assertNull(ourNextAlarm());
        assertEquals(AlarmRecord.Status.DISABLED, stored(A).status);

        // On again, then deleted on the server.
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 20)));
        assertNotNull(ourNextAlarm());
        ReconcilePlan deleted = AlarmScheduler.reconcile(context, List.of());
        assertEquals(List.of(A), deleted.remove);
        assertNull("deleted: gone from AlarmManager", ourNextAlarm());
        assertNull(stored(A));
    }

    @Test
    public void theSameListTwiceTouchesNothing() {
        List<AlarmSpec> server = List.of(inMinutes(A, 30), inMinutes(B, 40));
        AlarmScheduler.reconcile(context, server);
        Long trigger = ourNextAlarm();
        ReconcilePlan again = AlarmScheduler.reconcile(context, server);
        assertTrue(again.isEmpty());
        assertEquals(List.of(A, B), again.unchanged);
        assertEquals(trigger, ourNextAlarm());
    }

    @Test
    public void aCrashMidwayIsFinishedByTheNextAppStart() {
        // The phone has A at its old time and B, which the server has since deleted;
        // it died before the reconcile that would have fixed both.
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 50), inMinutes(B, 40)));
        // As if it then got as far as saving A's new time but not setting it in
        // AlarmManager (the store is written after AlarmManager, so this is the
        // worst case): the store says 20 minutes, AlarmManager still has 50.
        AlarmSpec edited = inMinutes(A, 20);
        AlarmStore.put(context, new AlarmRecord(edited, AlarmRecord.Status.SCHEDULED,
            NextTrigger.after(edited, java.time.Instant.now(), ZoneId.systemDefault()).toEpochMilli(), null));

        // Next app start: the plugin's load() reschedules from the store, then the page reconciles.
        AlarmScheduler.rescheduleAll(context, "app_start", ZoneId.systemDefault());
        ReconcilePlan p = AlarmScheduler.reconcile(context, List.of(edited));
        assertEquals(List.of(B), p.remove);
        assertEquals(stored(A).triggerAt, ourNextAlarm());
        assertNull(stored(B));
        assertTrue(AlarmScheduler.reconcile(context, List.of(edited)).isEmpty());
    }

    @Test
    public void theDebugHooksAlarmIsLeftAlone() {
        AlarmScheduler.put(context, inMinutes("device-test", 30));
        AlarmScheduler.reconcile(context, List.of());
        assertNotNull(stored("device-test"));
        assertNotNull(ourNextAlarm());
    }

    @Test
    public void aBadListChangesNothing() {
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 30)));
        List<AlarmSpec> twice = new ArrayList<>(List.of(inMinutes(B, 30), inMinutes(B, 35)));
        try {
            AlarmScheduler.reconcile(context, twice);
            org.junit.Assert.fail("a list naming an alarm twice is refused");
        }
        catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("listed twice"));
        }
        assertNotNull("A is still there", stored(A));
        assertNull(stored(B));
    }
}
