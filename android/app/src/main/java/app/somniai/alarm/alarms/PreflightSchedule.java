package app.somniai.alarm.alarms;

/**
 * When to run the bedtime check for the next alarm. Pure; tested in
 * PreflightScheduleTest.
 *
 * Bedtime is the one the wake plan gave (the web's "remind me at bedtime"), if
 * it falls in the night before this alarm; otherwise eight hours before the
 * alarm. The check runs half an hour before bedtime, so there is time to fix
 * things. Set later than that (an alarm made at bedtime), it runs at once,
 * still only once per alarm.
 */
final class PreflightSchedule {

    static final long MINUTE = 60_000L;
    static final long HOUR = 60 * MINUTE;
    static final long BEFORE_BEDTIME = 30 * MINUTE;
    static final long DEFAULT_SLEEP = 8 * HOUR;
    /** A planned bedtime further before the alarm than this belongs to another night. */
    static final long LONGEST_NIGHT = 16 * HOUR;
    /** Too close to the alarm to be worth a bedtime check: a nap, or it's already morning. */
    static final long TOO_CLOSE = HOUR;
    /** "At once" still leaves a moment, so setting several alarms gives one check. */
    static final long SOON = MINUTE;

    static final class Plan {
        final long checkAt;
        final long bedtime;
        final long alarmAt;
        /** Whether the bedtime came from the wake plan, rather than eight hours before. */
        final boolean planned;

        Plan(long checkAt, long bedtime, long alarmAt, boolean planned) {
            this.checkAt = checkAt;
            this.bedtime = bedtime;
            this.alarmAt = alarmAt;
            this.planned = planned;
        }
    }

    private PreflightSchedule() {}

    /**
     * @param nextAlarmAt the next alarm's trigger time, or null if none is set
     * @param plannedBedtime the wake plan's bedtime, or null
     * @param checkedFor the alarm time the last check ran for, or null
     * @return when to check, or null for no check
     */
    static Plan next(Long nextAlarmAt, Long plannedBedtime, Long checkedFor, long now) {
        if (nextAlarmAt == null || nextAlarmAt - now < TOO_CLOSE) {
            return null;
        }
        if (checkedFor != null && checkedFor.longValue() == nextAlarmAt.longValue()) {
            return null;
        }
        boolean planned = plannedBedtime != null
            && plannedBedtime < nextAlarmAt
            && nextAlarmAt - plannedBedtime <= LONGEST_NIGHT;
        long bedtime = planned ? plannedBedtime : nextAlarmAt - DEFAULT_SLEEP;
        long checkAt = Math.max(bedtime - BEFORE_BEDTIME, now + SOON);
        return new Plan(checkAt, bedtime, nextAlarmAt, planned);
    }
}
