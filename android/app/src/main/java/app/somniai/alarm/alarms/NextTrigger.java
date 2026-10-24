package app.somniai.alarm.alarms;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;

/**
 * When an alarm rings next. Pure: no Android, no clock of its own, so the JVM
 * tests can pin "now" and the time zone.
 *
 * Daylight-saving rules, decided here and tested in NextTriggerTest:
 * <ul>
 *   <li>A time the clocks skip (02:30 when 02:00 jumps to 03:00) rings at the
 *       moment of the jump, the first instant the wall clock is past it.
 *       Skipping the alarm would be worse than ringing a little early by the
 *       clock face.</li>
 *   <li>A time that happens twice (01:30 when 02:00 falls back to 01:00) rings
 *       once, the first time. The repeat an hour later is not a second alarm.</li>
 * </ul>
 */
public final class NextTrigger {

    private NextTrigger() {}

    /**
     * The first instant strictly after {@code after} at which the alarm rings,
     * or null if it never will (disabled, or a one-off whose time has passed).
     *
     * Strictly after: a repeating alarm asked again at the instant it fired
     * gives its next occurrence, not the same one.
     */
    public static Instant after(AlarmSpec alarm, Instant after, ZoneId zone) {
        if (!alarm.enabled) {
            return null;
        }
        LocalTime time = LocalTime.of(alarm.hour, alarm.minute);
        if (alarm.isOneOff()) {
            Instant at = resolve(alarm.date, time, zone);
            return at.isAfter(after) ? at : null;
        }
        LocalDate today = after.atZone(zone).toLocalDate();
        // Eight days: today, and a full week on, for an alarm that repeats on
        // one day only and has already rung today.
        for (int i = 0; i < 8; i++) {
            LocalDate day = today.plusDays(i);
            if (!alarm.days.contains(day.getDayOfWeek())) {
                continue;
            }
            Instant at = resolve(day, time, zone);
            if (at.isAfter(after)) {
                return at;
            }
        }
        return null;
    }

    /** The instant a wall-clock time on a date happens in a zone, by the rules above. */
    static Instant resolve(LocalDate date, LocalTime time, ZoneId zone) {
        LocalDateTime local = LocalDateTime.of(date, time);
        ZoneRules rules = zone.getRules();
        ZoneOffsetTransition transition = rules.getTransition(local);
        if (transition == null) {
            return local.atZone(zone).toInstant();
        }
        if (transition.isGap()) {
            return transition.getInstant();
        }
        // An overlap: the offset before the transition gives the first time.
        return local.atOffset(transition.getOffsetBefore()).toInstant();
    }
}
