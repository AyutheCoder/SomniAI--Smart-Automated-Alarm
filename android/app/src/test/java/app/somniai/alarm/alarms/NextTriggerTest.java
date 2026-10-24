package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.zone.ZoneOffsetTransition;
import java.util.EnumSet;
import org.junit.Test;

/**
 * The scheduling maths. Dates are 2026 unless said otherwise. Transitions used:
 * Europe/London springs forward 29 Mar 01:00 GMT to 02:00 BST and falls back
 * 25 Oct 02:00 BST to 01:00 GMT; America/New_York 8 Mar 02:00 to 03:00 and
 * 1 Nov 02:00 to 01:00; Australia/Lord_Howe moves by half an hour, 4 Oct
 * 02:00 to 02:30. Asia/Kolkata has no daylight saving.
 */
public class NextTriggerTest {

    static final ZoneId LONDON = ZoneId.of("Europe/London");
    static final ZoneId NEW_YORK = ZoneId.of("America/New_York");
    static final ZoneId KOLKATA = ZoneId.of("Asia/Kolkata");
    static final ZoneId LORD_HOWE = ZoneId.of("Australia/Lord_Howe");

    static AlarmSpec daily(int h, int m) {
        return new AlarmSpec("a", "", h, m, EnumSet.allOf(DayOfWeek.class), null, true, null);
    }

    static AlarmSpec on(DayOfWeek first, int h, int m, DayOfWeek... rest) {
        return new AlarmSpec("a", "", h, m, EnumSet.of(first, rest), null, true, null);
    }

    static AlarmSpec once(String date, int h, int m) {
        return new AlarmSpec("a", "", h, m, EnumSet.noneOf(DayOfWeek.class), LocalDate.parse(date), true, null);
    }

    static Instant local(String dateTime, ZoneId zone) {
        return LocalDateTime.parse(dateTime).atZone(zone).toInstant();
    }

    static String localOf(Instant i, ZoneId zone) {
        return i.atZone(zone).toLocalDateTime().toString();
    }

    // --- Daylight saving ---

    @Test
    public void aTimeTheClocksSkipRingsAtTheJump() {
        // 01:30 does not exist in London on 29 Mar: 01:00 GMT becomes 02:00 BST.
        Instant next = NextTrigger.after(daily(1, 30), local("2026-03-28T23:00", LONDON), LONDON);
        assertEquals(Instant.parse("2026-03-29T01:00:00Z"), next);
        assertEquals("2026-03-29T02:00", localOf(next, LONDON));
    }

    @Test
    public void aTimeTheClocksSkipRingsAtTheJumpInNewYork() {
        // 02:30 does not exist on 8 Mar: 02:00 EST becomes 03:00 EDT.
        Instant next = NextTrigger.after(daily(2, 30), local("2026-03-07T22:00", NEW_YORK), NEW_YORK);
        assertEquals(Instant.parse("2026-03-08T07:00:00Z"), next);
        assertEquals("2026-03-08T03:00", localOf(next, NEW_YORK));
    }

    @Test
    public void aHalfHourJumpIsHandledTheSameWay() {
        // Lord Howe Island moves 02:00 to 02:30 on 4 Oct; 02:15 is skipped.
        Instant next = NextTrigger.after(daily(2, 15), local("2026-10-03T22:00", LORD_HOWE), LORD_HOWE);
        assertEquals("2026-10-04T02:30", localOf(next, LORD_HOWE));
    }

    @Test
    public void aTimeThatHappensTwiceRingsOnceTheFirstTime() {
        // 01:30 happens twice in London on 25 Oct: first in BST (00:30Z), then in GMT (01:30Z).
        AlarmSpec alarm = daily(1, 30);
        Instant first = NextTrigger.after(alarm, local("2026-10-24T23:00", LONDON), LONDON);
        assertEquals(Instant.parse("2026-10-25T00:30:00Z"), first);
        // Asked again once it has rung: tomorrow, not the repeat an hour later.
        Instant second = NextTrigger.after(alarm, first, LONDON);
        assertEquals(Instant.parse("2026-10-26T01:30:00Z"), second);
    }

    @Test
    public void aTimeThatHappensTwiceRingsOnceTheFirstTimeInNewYork() {
        Instant first = NextTrigger.after(daily(1, 30), local("2026-10-31T23:00", NEW_YORK), NEW_YORK);
        assertEquals(Instant.parse("2026-11-01T05:30:00Z"), first);
        assertEquals(Instant.parse("2026-11-02T06:30:00Z"), NextTrigger.after(daily(1, 30), first, NEW_YORK));
    }

    @Test
    public void aDailyAlarmKeepsItsClockTimeAcrossTheChanges() {
        AlarmSpec seven = daily(7, 0);
        Instant beforeSpring = NextTrigger.after(seven, local("2026-03-28T06:00", LONDON), LONDON);
        Instant afterSpring = NextTrigger.after(seven, beforeSpring, LONDON);
        assertEquals("2026-03-29T07:00", localOf(afterSpring, LONDON));
        assertEquals(Duration.ofHours(23), Duration.between(beforeSpring, afterSpring));

        Instant beforeFall = NextTrigger.after(seven, local("2026-10-24T06:00", LONDON), LONDON);
        Instant afterFall = NextTrigger.after(seven, beforeFall, LONDON);
        assertEquals("2026-10-25T07:00", localOf(afterFall, LONDON));
        assertEquals(Duration.ofHours(25), Duration.between(beforeFall, afterFall));
    }

    @Test
    public void aOneOffOnTheNightOfAChangeUsesThatNightsRules() {
        Instant next = NextTrigger.after(once("2026-03-29", 6, 0), local("2026-03-28T22:00", LONDON), LONDON);
        assertEquals(Instant.parse("2026-03-29T05:00:00Z"), next);
    }

    // --- Across midnight ---

    @Test
    public void setBeforeMidnightForJustAfterMidnight() {
        Instant next = NextTrigger.after(daily(0, 10), local("2026-10-24T23:50", KOLKATA), KOLKATA);
        assertEquals("2026-10-25T00:10", localOf(next, KOLKATA));
    }

    @Test
    public void setJustAfterMidnightForLateTheSameEvening() {
        Instant next = NextTrigger.after(daily(23, 50), local("2026-10-24T00:10", KOLKATA), KOLKATA);
        assertEquals("2026-10-24T23:50", localOf(next, KOLKATA));
    }

    @Test
    public void weekdaysSetLateFridayForAfterMidnightWaitsForMonday() {
        // 23 Oct 2026 is a Friday; Saturday 00:05 is not a weekday.
        AlarmSpec weekdays = on(DayOfWeek.MONDAY, 0, 5, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY);
        Instant next = NextTrigger.after(weekdays, local("2026-10-23T23:59:30", KOLKATA), KOLKATA);
        assertEquals("2026-10-26T00:05", localOf(next, KOLKATA));
    }

    @Test
    public void aOneOffForMidnightTomorrow() {
        Instant now = local("2026-10-24T23:59", KOLKATA);
        Instant next = NextTrigger.after(once("2026-10-25", 0, 0), now, KOLKATA);
        assertEquals(Duration.ofMinutes(1), Duration.between(now, next));
    }

    @Test
    public void acrossTheNewYear() {
        Instant next = NextTrigger.after(daily(0, 10), local("2026-12-31T23:50", KOLKATA), KOLKATA);
        assertEquals("2027-01-01T00:10", localOf(next, KOLKATA));
    }

    @Test
    public void aLeapDay() {
        Instant next = NextTrigger.after(once("2028-02-29", 6, 0), local("2028-02-28T22:00", KOLKATA), KOLKATA);
        assertEquals("2028-02-29T06:00", localOf(next, KOLKATA));
    }

    // --- Ordinary cases ---

    @Test
    public void strictlyAfterNow() {
        Instant seven = local("2026-10-24T07:00", KOLKATA);
        assertEquals("2026-10-25T07:00", localOf(NextTrigger.after(daily(7, 0), seven, KOLKATA), KOLKATA));
    }

    @Test
    public void oneDayAWeekThatRangTodayWaitsAWeek() {
        // 24 Oct 2026 is a Saturday.
        Instant next = NextTrigger.after(on(DayOfWeek.SATURDAY, 7, 0), local("2026-10-24T08:00", KOLKATA), KOLKATA);
        assertEquals("2026-10-31T07:00", localOf(next, KOLKATA));
    }

    @Test
    public void aOneOffInThePastNeverRings() {
        assertNull(NextTrigger.after(once("2026-10-24", 6, 0), local("2026-10-24T06:01", KOLKATA), KOLKATA));
    }

    @Test
    public void aDisabledAlarmNeverRings() {
        assertNull(NextTrigger.after(daily(7, 0).withEnabled(false), local("2026-10-24T06:00", KOLKATA), KOLKATA));
    }

    @Test
    public void aTimeZoneChangeKeepsTheWallClockTime() {
        Instant now = Instant.parse("2026-10-24T00:00:00Z");
        assertEquals("2026-10-24T07:00", localOf(NextTrigger.after(daily(7, 0), now, KOLKATA), KOLKATA));
        assertEquals("2026-10-24T07:00", localOf(NextTrigger.after(daily(7, 0), now, LONDON), LONDON));
        assertEquals("2026-10-24T07:00", localOf(NextTrigger.after(daily(7, 0), now, NEW_YORK), NEW_YORK));
    }

    /**
     * Every half hour of the day, from every evening of 2026, in zones with
     * whole-hour, half-hour and no daylight saving: the next trigger is after
     * now, on today or tomorrow, at the alarm's clock time, or at the jump
     * when the clocks skip that time.
     */
    @Test
    public void aYearOfDailyAlarmsInFiveZones() {
        ZoneId[] zones = { LONDON, NEW_YORK, KOLKATA, LORD_HOWE, ZoneId.of("Australia/Sydney") };
        int checked = 0;
        for (ZoneId zone : zones) {
            for (LocalDate day = LocalDate.of(2026, 1, 1); day.getYear() == 2026; day = day.plusDays(1)) {
                Instant now = local(day + "T21:17", zone);
                for (int slot = 0; slot < 48; slot++) {
                    LocalTime time = LocalTime.of(slot / 2, (slot % 2) * 30);
                    Instant next = NextTrigger.after(daily(time.getHour(), time.getMinute()), now, zone);
                    assertTrue(next.isAfter(now));
                    LocalDate expectedDay = time.isAfter(LocalTime.of(21, 17)) ? day : day.plusDays(1);
                    LocalDateTime wanted = LocalDateTime.of(expectedDay, time);
                    LocalDateTime got = next.atZone(zone).toLocalDateTime();
                    if (!got.equals(wanted)) {
                        ZoneOffsetTransition t = zone.getRules().getTransition(wanted);
                        if (t == null || !t.isGap() || !t.getInstant().equals(next)) {
                            fail(zone + " " + wanted + " gave " + got);
                        }
                    }
                    checked++;
                }
            }
        }
        assertEquals(5 * 365 * 48, checked);
    }
}
