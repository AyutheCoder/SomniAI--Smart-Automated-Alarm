package app.somniai.alarm.alarms;

import static app.somniai.alarm.alarms.NextTriggerTest.KOLKATA;
import static app.somniai.alarm.alarms.NextTriggerTest.LONDON;
import static app.somniai.alarm.alarms.NextTriggerTest.NEW_YORK;
import static app.somniai.alarm.alarms.NextTriggerTest.daily;
import static app.somniai.alarm.alarms.NextTriggerTest.local;
import static app.somniai.alarm.alarms.NextTriggerTest.localOf;
import static app.somniai.alarm.alarms.NextTriggerTest.once;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.AlarmRecord.Status;
import java.time.Instant;
import org.junit.Test;

/** Rescheduling (boot, time change, app start) and what happens when an alarm fires. */
public class AlarmPlannerTest {

    static long ms(Instant i) {
        return i.toEpochMilli();
    }

    static AlarmRecord scheduled(AlarmSpec spec, Instant at, Long lastFiredAt) {
        return new AlarmRecord(spec, Status.SCHEDULED, ms(at), lastFiredAt);
    }

    @Test
    public void reschedulingAFutureAlarmLeavesItWhereItWas() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        AlarmPlanner.Planned p = AlarmPlanner.plan(scheduled(daily(7, 0), seven, null), local("2026-10-24T22:00", KOLKATA), KOLKATA, true);
        assertEquals(Status.SCHEDULED, p.record.status);
        assertEquals(Long.valueOf(ms(seven)), p.record.triggerAt);
        assertNull(p.missed);
    }

    @Test
    public void aRebootJustAfterTheAlarmTimeStillRingsItLate() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        Instant bootedAt = seven.plusSeconds(5 * 60);
        AlarmPlanner.Planned p = AlarmPlanner.plan(scheduled(daily(7, 0), seven, null), bootedAt, KOLKATA, true);
        assertEquals(Status.SCHEDULED, p.record.status);
        assertEquals("kept at its time; AlarmManager rings a past trigger at once", Long.valueOf(ms(seven)), p.record.triggerAt);
        assertNull(p.missed);
    }

    @Test
    public void longAfterTheAlarmTimeTheOccurrenceIsReportedMissed() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        Instant later = seven.plusMillis(AlarmPlanner.LATE_GRACE_MS + 1);
        AlarmPlanner.Planned p = AlarmPlanner.plan(scheduled(daily(7, 0), seven, null), later, KOLKATA, true);
        assertEquals(Long.valueOf(ms(seven)), p.missed);
        assertEquals(Status.SCHEDULED, p.record.status);
        assertEquals("2026-10-26T07:00", localOf(Instant.ofEpochMilli(p.record.triggerAt), KOLKATA));
    }

    @Test
    public void aMissedOneOffIsMarkedMissedAndTurnedOff() {
        Instant six = local("2026-10-25T06:00", KOLKATA);
        AlarmPlanner.Planned p = AlarmPlanner.plan(scheduled(once("2026-10-25", 6, 0), six, null), six.plusSeconds(3600), KOLKATA, true);
        assertEquals(Status.MISSED, p.record.status);
        assertFalse(p.record.spec.enabled);
        assertNull(p.record.triggerAt);
        assertEquals(Long.valueOf(ms(six)), p.missed);
        // Rescheduling again does not report it a second time.
        AlarmPlanner.Planned again = AlarmPlanner.plan(p.record, six.plusSeconds(7200), KOLKATA, true);
        assertEquals(Status.MISSED, again.record.status);
        assertNull(again.missed);
    }

    @Test
    public void anOccurrenceThatRangIsNotMissed() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        AlarmRecord rang = new AlarmRecord(daily(7, 0), Status.SCHEDULED, ms(seven), ms(seven) + 200);
        assertNull(AlarmPlanner.plan(rang, seven.plusSeconds(3600), KOLKATA, true).missed);
    }

    @Test
    public void disabledAndFinishedAlarmsAreNotScheduled() {
        Instant now = local("2026-10-24T22:00", KOLKATA);
        AlarmPlanner.Planned off = AlarmPlanner.plan(scheduled(daily(7, 0).withEnabled(false), now.plusSeconds(3600), null), now, KOLKATA, true);
        assertEquals(Status.DISABLED, off.record.status);
        assertNull(off.record.triggerAt);
        AlarmRecord done = new AlarmRecord(once("2026-10-24", 6, 0).withEnabled(false), Status.DONE, null, 1L);
        assertEquals(Status.DONE, AlarmPlanner.plan(done, now, KOLKATA, true).record.status);
    }

    @Test
    public void withoutExactAlarmAccessItWaitsAndIsScheduledOnceAllowed() {
        Instant now = local("2026-10-24T22:00", KOLKATA);
        AlarmRecord fresh = new AlarmRecord(daily(7, 0), Status.DISABLED, null, null);
        AlarmRecord waiting = AlarmPlanner.plan(fresh, now, KOLKATA, false).record;
        assertEquals(Status.WAITING_FOR_PERMISSION, waiting.status);
        assertNull(waiting.triggerAt);
        AlarmRecord allowed = AlarmPlanner.plan(waiting, now.plusSeconds(60), KOLKATA, true).record;
        assertEquals(Status.SCHEDULED, allowed.status);
        assertEquals("2026-10-25T07:00", localOf(Instant.ofEpochMilli(allowed.triggerAt), KOLKATA));
    }

    @Test
    public void aOneOffWhoseTimePassedWhileWaitingIsMissed() {
        AlarmRecord waiting = new AlarmRecord(once("2026-10-25", 6, 0), Status.WAITING_FOR_PERMISSION, null, null);
        AlarmPlanner.Planned p = AlarmPlanner.plan(waiting, local("2026-10-25T09:00", KOLKATA), KOLKATA, true);
        assertEquals(Status.MISSED, p.record.status);
        assertEquals(Long.valueOf(ms(local("2026-10-25T06:00", KOLKATA))), p.missed);
    }

    @Test
    public void settingTheClockBackDoesNotRingTheSameMorningTwice() {
        Instant rang = local("2026-10-25T07:00", KOLKATA);
        Instant tomorrow = local("2026-10-26T07:00", KOLKATA);
        AlarmRecord r = new AlarmRecord(daily(7, 0), Status.SCHEDULED, ms(tomorrow), ms(rang));
        // The user sets the clock back to 06:50: today's 07:00 already rang.
        AlarmRecord after = AlarmPlanner.plan(r, local("2026-10-25T06:50", KOLKATA), KOLKATA, true).record;
        assertEquals(Long.valueOf(ms(tomorrow)), after.triggerAt);
    }

    @Test
    public void flyingWestRingsAtSevenInTheNewZone() {
        // Rang at 07:00 in London (06:00Z); now 04:00 in New York, where 07:00 is still ahead.
        Instant rangInLondon = local("2026-10-24T07:00", LONDON);
        AlarmRecord r = new AlarmRecord(daily(7, 0), Status.SCHEDULED, ms(local("2026-10-25T07:00", LONDON)), ms(rangInLondon));
        AlarmRecord after = AlarmPlanner.plan(r, local("2026-10-24T04:00", NEW_YORK), NEW_YORK, true).record;
        assertEquals("2026-10-24T07:00", localOf(Instant.ofEpochMilli(after.triggerAt), NEW_YORK));
    }

    @Test
    public void onlyTheScheduledOccurrenceRings() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        AlarmRecord r = scheduled(daily(7, 0), seven, null);
        assertTrue(AlarmPlanner.shouldRing(r, ms(seven)));
        assertFalse("edited since", AlarmPlanner.shouldRing(r, ms(seven) - 60_000));
        assertFalse("turned off", AlarmPlanner.shouldRing(scheduled(daily(7, 0).withEnabled(false), seven, null), ms(seven)));
        assertFalse("waiting", AlarmPlanner.shouldRing(new AlarmRecord(daily(7, 0), Status.WAITING_FOR_PERMISSION, ms(seven), null), ms(seven)));
        assertFalse("deleted", AlarmPlanner.shouldRing(null, ms(seven)));
    }

    @Test
    public void aOneOffIsDoneOnceItRings() {
        Instant six = local("2026-10-25T06:00", KOLKATA);
        AlarmRecord after = AlarmPlanner.afterFiring(scheduled(once("2026-10-25", 6, 0), six, null), six.plusMillis(40), KOLKATA, true);
        assertEquals(Status.DONE, after.status);
        assertFalse(after.spec.enabled);
        assertEquals(Long.valueOf(ms(six) + 40), after.lastFiredAt);
    }

    @Test
    public void aRepeatingAlarmMovesToItsNextOccurrenceEvenIfDeliveredEarly() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        AlarmRecord r = scheduled(daily(7, 0), seven, null);
        AlarmRecord early = AlarmPlanner.afterFiring(r, seven.minusMillis(50), KOLKATA, true);
        assertEquals("2026-10-26T07:00", localOf(Instant.ofEpochMilli(early.triggerAt), KOLKATA));
        AlarmRecord late = AlarmPlanner.afterFiring(r, seven.plusSeconds(90), KOLKATA, true);
        assertEquals("2026-10-26T07:00", localOf(Instant.ofEpochMilli(late.triggerAt), KOLKATA));
    }

    @Test
    public void aRepeatingAlarmThatRangAcrossAChangeKeepsItsClockTime() {
        // Rang 07:00 GMT on the Saturday before spring forward; next is 07:00 BST.
        Instant rang = local("2026-03-28T07:00", LONDON);
        AlarmRecord after = AlarmPlanner.afterFiring(scheduled(daily(7, 0), rang, null), rang, LONDON, true);
        assertEquals("2026-03-29T07:00", localOf(Instant.ofEpochMilli(after.triggerAt), LONDON));
    }

    @Test
    public void afterRingingWithoutAccessItWaits() {
        Instant seven = local("2026-10-25T07:00", KOLKATA);
        AlarmRecord after = AlarmPlanner.afterFiring(scheduled(daily(7, 0), seven, null), seven, KOLKATA, false);
        assertEquals(Status.WAITING_FOR_PERMISSION, after.status);
        assertEquals(Long.valueOf(ms(seven)), after.lastFiredAt);
    }
}
