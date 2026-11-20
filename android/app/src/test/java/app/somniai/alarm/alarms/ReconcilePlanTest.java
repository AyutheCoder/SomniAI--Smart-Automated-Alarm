package app.somniai.alarm.alarms;

import static app.somniai.alarm.alarms.NextTriggerTest.KOLKATA;
import static app.somniai.alarm.alarms.NextTriggerTest.local;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import app.somniai.alarm.alarms.AlarmRecord.Status;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/**
 * Keeping the phone's schedule in step with the server's list: create, edit,
 * disable, delete, the same list twice, and a reconcile cut short by a crash.
 */
public class ReconcilePlanTest {

    static final Instant NOW = local("2026-10-24T22:00", KOLKATA);
    static final String A = "64f0a1b2c3d4e5f601234567";
    static final String B = "64f0a1b2c3d4e5f60123456b";
    static final String C = "64f0a1b2c3d4e5f60123456c";

    static AlarmSpec daily(String id, int h, int m) {
        return new AlarmSpec(id, "Wake", h, m, EnumSet.allOf(DayOfWeek.class), null, true, null);
    }

    static AlarmSpec once(String id, String date, int h, int m) {
        return new AlarmSpec(id, "Flight", h, m, EnumSet.noneOf(DayOfWeek.class), LocalDate.parse(date), true, null);
    }

    static AlarmRecord scheduled(AlarmSpec s) {
        return new AlarmRecord(s, Status.SCHEDULED, NextTrigger.after(s, NOW, KOLKATA).toEpochMilli(), null);
    }

    static ReconcilePlan diff(Collection<AlarmRecord> here, List<AlarmSpec> server) {
        return ReconcilePlan.diff(here, server, NOW, KOLKATA);
    }

    static List<String> ids(List<AlarmSpec> specs) {
        List<String> out = new ArrayList<>();
        for (AlarmSpec s : specs) {
            out.add(s.id);
        }
        return out;
    }

    @Test
    public void aNewAlarmOnTheServerIsAdded() {
        ReconcilePlan p = diff(List.of(), List.of(daily(A, 7, 0)));
        assertEquals(List.of(A), ids(p.put));
        assertTrue(p.remove.isEmpty());
    }

    @Test
    public void anEditedAlarmIsReplacedAndAnUntouchedOneIsLeftAlone() {
        AlarmSpec a = daily(A, 7, 0);
        AlarmSpec b = daily(B, 8, 0);
        ReconcilePlan p = diff(List.of(scheduled(a), scheduled(b)), List.of(daily(A, 6, 30), b));
        assertEquals(List.of(A), ids(p.put));
        assertEquals(6, p.put.get(0).hour);
        assertEquals(List.of(B), p.unchanged);
    }

    @Test
    public void everyFieldTheWebAppSetsCountsAsAnEdit() {
        AlarmSpec a = daily(A, 7, 0);
        AlarmRecord here = scheduled(a);
        List<AlarmSpec> edits = List.of(
            new AlarmSpec(A, "Renamed", 7, 0, a.days, null, true, null),
            new AlarmSpec(A, "Wake", 7, 1, a.days, null, true, null),
            new AlarmSpec(A, "Wake", 7, 0, EnumSet.of(DayOfWeek.MONDAY), null, true, null),
            new AlarmSpec(A, "Wake", 7, 0, EnumSet.noneOf(DayOfWeek.class), LocalDate.parse("2026-10-25"), true, null),
            a.withEnabled(false),
            new AlarmSpec(A, "Wake", 7, 0, a.days, null, true, "{\"challenge\":{\"required\":false}}"));
        for (AlarmSpec e : edits) {
            assertEquals(List.of(A), ids(diff(List.of(here), List.of(e)).put));
        }
    }

    @Test
    public void disablingIsAnEditThatTurnsItOff() {
        ReconcilePlan p = diff(List.of(scheduled(daily(A, 7, 0))), List.of(daily(A, 7, 0).withEnabled(false)));
        assertEquals(List.of(A), ids(p.put));
        assertEquals(false, p.put.get(0).enabled);
    }

    @Test
    public void anAlarmDeletedOnTheServerIsRemoved() {
        ReconcilePlan p = diff(List.of(scheduled(daily(A, 7, 0)), scheduled(daily(B, 8, 0))), List.of(daily(B, 8, 0)));
        assertEquals(List.of(A), p.remove);
        assertTrue(p.put.isEmpty());
    }

    @Test
    public void anEmptyListRemovesEveryServerAlarm() {
        // Why the web app never reconciles from a list that failed to load.
        ReconcilePlan p = diff(List.of(scheduled(daily(A, 7, 0)), scheduled(daily(B, 8, 0))), List.of());
        assertEquals(List.of(A, B), p.remove);
    }

    @Test
    public void theSameListTwiceChangesNothingTheSecondTime() {
        List<AlarmSpec> server = List.of(daily(A, 7, 0), once(B, "2026-10-25", 5, 0));
        Map<String, AlarmRecord> phone = new LinkedHashMap<>();
        apply(phone, diff(phone.values(), server), Integer.MAX_VALUE);
        ReconcilePlan again = diff(phone.values(), server);
        assertTrue(again.isEmpty());
        assertEquals(List.of(A, B), again.unchanged);
    }

    @Test
    public void theDebugHooksAlarmsAreLeftAlone() {
        AlarmRecord debug = scheduled(daily("device-test", 7, 0));
        assertTrue(diff(List.of(debug), List.of()).remove.isEmpty());
        try {
            diff(List.of(), List.of(daily("device-test", 7, 0)));
            fail("a non-server id in the server's list is refused");
        }
        catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("not a server alarm id"));
        }
    }

    @Test
    public void aListNamingAnAlarmTwiceIsRefused() {
        try {
            diff(List.of(), List.of(daily(A, 7, 0), daily(A, 8, 0)));
            fail();
        }
        catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("listed twice"));
        }
    }

    @Test
    public void aOneOffThatAlreadyRangHereIsNotArmedAgainBeforeTheServerHears() {
        AlarmSpec flight = once(A, "2026-10-24", 6, 0);
        AlarmRecord rang = new AlarmRecord(flight.withEnabled(false), Status.DONE, null, local("2026-10-24T06:00", KOLKATA).toEpochMilli());
        // The server still says enabled: the dismissal is in the outbox.
        ReconcilePlan p = diff(List.of(rang), List.of(flight));
        assertEquals(List.of(A), p.keptHistory);
        assertTrue(p.isEmpty());
        AlarmRecord missed = new AlarmRecord(flight.withEnabled(false), Status.MISSED, null, null);
        assertEquals(List.of(A), diff(List.of(missed), List.of(flight)).keptHistory);
    }

    @Test
    public void butAOneOffThatRangAndWasThenGivenANewTimeIsScheduled() {
        AlarmSpec flight = once(A, "2026-10-24", 6, 0);
        AlarmRecord rang = new AlarmRecord(flight.withEnabled(false), Status.DONE, null, 1L);
        ReconcilePlan p = diff(List.of(rang), List.of(once(A, "2026-10-26", 6, 0)));
        assertEquals(List.of(A), ids(p.put));
    }

    @Test
    public void aOneOffInThePastIsNotScheduledAndAnOldCopyIsRemoved() {
        AlarmSpec past = once(A, "2026-10-24", 6, 0);
        assertEquals(List.of(A), diff(List.of(), List.of(past)).past);
        assertTrue(diff(List.of(), List.of(past)).put.isEmpty());
        // Moved from tomorrow to a time already gone: the tomorrow copy must not ring.
        ReconcilePlan p = diff(List.of(scheduled(once(A, "2026-10-25", 6, 0))), List.of(past));
        assertEquals(List.of(A), p.remove);
    }

    @Test
    public void aDisabledOneOffInThePastIsSimplyStoredOff() {
        AlarmSpec off = once(A, "2026-10-24", 6, 0).withEnabled(false);
        assertEquals(List.of(A), ids(diff(List.of(), List.of(off)).put));
    }

    /**
     * The app dies after k of the n steps. Whatever k, the next reconcile
     * finds exactly the steps left, and after it the phone matches the server.
     */
    @Test
    public void aReconcileCutShortByACrashIsFinishedByTheNextOne() {
        Map<String, AlarmRecord> before = new LinkedHashMap<>();
        for (AlarmSpec s : List.of(daily(A, 7, 0), daily(B, 8, 0), daily(C, 9, 0), daily("64f0a1b2c3d4e5f60123456d", 10, 0))) {
            before.put(s.id, scheduled(s));
        }
        before.put("device-test", scheduled(daily("device-test", 11, 0)));
        List<AlarmSpec> server = List.of(
            daily(A, 6, 30),                             // edited
            daily(B, 8, 0),                              // unchanged
            daily(C, 9, 0).withEnabled(false),           // disabled
            daily("64f0a1b2c3d4e5f60123456e", 5, 45),    // new
            once("64f0a1b2c3d4e5f60123456f", "2026-10-26", 4, 0)); // new one-off
        // ...and d deleted.
        int steps = steps(diff(before.values(), server));
        assertEquals("remove d; put A, C, e, f", 5, steps);

        for (int k = 0; k <= steps; k++) {
            Map<String, AlarmRecord> phone = new LinkedHashMap<>(before);
            apply(phone, diff(phone.values(), server), k);          // dies after k steps
            ReconcilePlan next = diff(phone.values(), server);     // next app start
            assertEquals("after a crash at step " + k, steps - k, steps(next));
            apply(phone, next, Integer.MAX_VALUE);
            assertTrue("converged after a crash at step " + k, diff(phone.values(), server).isEmpty());
            assertTrue("the debug alarm survives", phone.containsKey("device-test"));
            assertEquals(6, phone.get(A).spec.hour);
            assertEquals(false, phone.get(C).spec.enabled);
            assertTrue(!phone.containsKey("64f0a1b2c3d4e5f60123456d"));
        }
    }

    static int steps(ReconcilePlan p) {
        return p.remove.size() + p.put.size();
    }

    /** What AlarmScheduler.reconcile does to the store, stopping after {@code max} steps. */
    static void apply(Map<String, AlarmRecord> phone, ReconcilePlan p, int max) {
        int done = 0;
        for (String id : p.remove) {
            if (done++ >= max) {
                return;
            }
            phone.remove(id);
        }
        for (AlarmSpec s : p.put) {
            if (done++ >= max) {
                return;
            }
            AlarmRecord start = new AlarmRecord(s, Status.DISABLED, null, null);
            phone.put(s.id, AlarmPlanner.plan(start, NOW, KOLKATA, true).record);
        }
    }
}
