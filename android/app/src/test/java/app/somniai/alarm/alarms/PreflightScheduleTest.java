package app.somniai.alarm.alarms;

import static app.somniai.alarm.alarms.PreflightSchedule.HOUR;
import static app.somniai.alarm.alarms.PreflightSchedule.MINUTE;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.PreflightSchedule.Plan;
import org.junit.Test;

/** When the bedtime check runs. Times are hours of an evening, from an arbitrary midnight. */
public class PreflightScheduleTest {

    static final long MIDNIGHT = 1_793_000_000_000L - (1_793_000_000_000L % (24 * HOUR));

    static long at(double hours) {
        return MIDNIGHT + Math.round(hours * HOUR);
    }

    @Test
    public void noAlarmNoCheck() {
        assertNull(PreflightSchedule.next(null, null, null, at(18)));
        assertNull(PreflightSchedule.next(null, at(22), null, at(18)));
    }

    @Test
    public void withoutAPlanBedtimeIsEightHoursBeforeAndTheCheckHalfAnHourBeforeThat() {
        Plan p = PreflightSchedule.next(at(31), null, null, at(18)); // 07:00 tomorrow
        assertNotNull(p);
        assertEquals(at(23), p.bedtime);
        assertEquals(at(22.5), p.checkAt);
        assertEquals(at(31), p.alarmAt);
        assertFalse(p.planned);
    }

    @Test
    public void thePlannedBedtimeIsUsedWhenItBelongsToThisNight() {
        Plan p = PreflightSchedule.next(at(30.5), at(22.25), null, at(18)); // 06:30, bed 22:15
        assertTrue(p.planned);
        assertEquals(at(22.25), p.bedtime);
        assertEquals(at(21.75), p.checkAt);
    }

    @Test
    public void aPlannedBedtimeForAnotherNightIsIgnored() {
        // After the alarm: a later night's plan.
        assertFalse(PreflightSchedule.next(at(31), at(32), null, at(18)).planned);
        // More than 16 hours before the alarm: a past night's.
        assertFalse(PreflightSchedule.next(at(31), at(31) - 16 * HOUR - 1, null, at(10)).planned);
        assertTrue(PreflightSchedule.next(at(31), at(31) - 16 * HOUR, null, at(10)).planned);
    }

    @Test
    public void anAlarmSetAtBedtimeIsCheckedAlmostAtOnce() {
        // 23:10, alarm 07:00: the usual check time (22:30) has gone.
        Plan p = PreflightSchedule.next(at(31), null, null, at(23) + 10 * MINUTE);
        assertEquals(at(23) + 11 * MINUTE, p.checkAt);
        // Planned bedtime already passed too.
        p = PreflightSchedule.next(at(30), at(22), null, at(22.5));
        assertEquals(at(22.5) + MINUTE, p.checkAt);
        assertEquals(at(22), p.bedtime);
    }

    @Test
    public void notWithinAnHourOfTheAlarm() {
        assertNull(PreflightSchedule.next(at(31), null, null, at(31) - HOUR + 1));
        assertNotNull(PreflightSchedule.next(at(31), null, null, at(31) - HOUR));
    }

    @Test
    public void onceForEachAlarm() {
        assertNull("already checked for this alarm", PreflightSchedule.next(at(31), null, at(31), at(23)));
        assertNotNull("checked for an earlier one", PreflightSchedule.next(at(31), null, at(7), at(23)));
    }

    @Test
    public void neverInThePast() {
        for (double now = 0; now < 31; now += 0.25) {
            Plan p = PreflightSchedule.next(at(31), at(22), null, at(now));
            if (p != null) {
                assertTrue("now " + now, p.checkAt > at(now));
                assertTrue("before the alarm, now " + now, p.checkAt < p.alarmAt);
            }
        }
    }
}
