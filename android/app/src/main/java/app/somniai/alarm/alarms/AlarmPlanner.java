package app.somniai.alarm.alarms;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;

/**
 * What to do with a stored alarm: on every reschedule (boot, time or zone
 * change, app update, permission granted, app start) and when it fires.
 * Pure, so it is tested on the JVM (AlarmPlannerTest); AlarmScheduler does
 * the Android side.
 */
public final class AlarmPlanner {

    /**
     * How late an unrung occurrence may still ring when everything is
     * rescheduled. Later than this it is reported missed instead: an alarm
     * going off hours late, the next time the app is opened, helps nobody.
     */
    public static final long LATE_GRACE_MS = 15 * 60_000L;

    private AlarmPlanner() {}

    /** A planned record, and the occurrence it missed if one went by unrung. */
    public static final class Planned {
        public final AlarmRecord record;
        /** Epoch millis of an occurrence that should have rung and didn't, or null. */
        public final Long missed;

        Planned(AlarmRecord record, Long missed) {
            this.record = record;
            this.missed = missed;
        }
    }

    /**
     * The alarm's state from now on.
     *
     * An occurrence that already rang is never rung again, even if the clock
     * is set back past it: the search starts after the later of now and the
     * last time it rang. A scheduled occurrence that is now in the past and
     * never rang (the phone was off, or the app was force-stopped, which makes
     * Android delete its alarms) is reported as missed rather than skipped
     * silently.
     */
    public static Planned plan(AlarmRecord current, Instant now, ZoneId zone, boolean exactAllowed) {
        AlarmSpec spec = current.spec;
        Long missed = null;
        if (spec.enabled && current.status == AlarmRecord.Status.SCHEDULED && current.triggerAt != null
                && current.triggerAt < now.toEpochMilli()
                && (current.lastFiredAt == null || current.lastFiredAt < current.triggerAt)) {
            if (now.toEpochMilli() - current.triggerAt <= LATE_GRACE_MS && exactAllowed) {
                // Due a moment ago and not rung yet: its delivery may still be on the way,
                // or the phone was off briefly. Set it again as it was; AlarmManager rings
                // a trigger in the past at once.
                return new Planned(current, null);
            }
            missed = current.triggerAt;
        }
        if (!spec.enabled) {
            AlarmRecord.Status status = current.status == AlarmRecord.Status.DONE || current.status == AlarmRecord.Status.MISSED
                ? current.status
                : AlarmRecord.Status.DISABLED;
            return new Planned(new AlarmRecord(spec, status, null, current.lastFiredAt), null);
        }
        Instant from = current.lastFiredAt != null && current.lastFiredAt > now.toEpochMilli()
            ? Instant.ofEpochMilli(current.lastFiredAt)
            : now;
        Instant next = NextTrigger.after(spec, from, zone);
        if (next == null) {
            // Only a one-off gets here: its time has passed and it never rang.
            Long when = missed != null ? missed : NextTrigger.resolve(spec.date, LocalTime.of(spec.hour, spec.minute), zone).toEpochMilli();
            return new Planned(new AlarmRecord(spec.withEnabled(false), AlarmRecord.Status.MISSED, null, current.lastFiredAt), when);
        }
        if (!exactAllowed) {
            return new Planned(new AlarmRecord(spec, AlarmRecord.Status.WAITING_FOR_PERMISSION, null, current.lastFiredAt), missed);
        }
        return new Planned(new AlarmRecord(spec, AlarmRecord.Status.SCHEDULED, next.toEpochMilli(), current.lastFiredAt), missed);
    }

    /**
     * Whether a delivered alarm should ring: only the occurrence the stored
     * record is scheduled for. A delivery that no longer matches (the alarm was
     * edited, disabled or deleted after it was set) is dropped.
     */
    public static boolean shouldRing(AlarmRecord current, long scheduledFor) {
        return current != null
            && current.spec.enabled
            && current.status == AlarmRecord.Status.SCHEDULED
            && current.triggerAt != null
            && current.triggerAt == scheduledFor;
    }

    /**
     * The record after it rang at {@code firedAt}: a one-off is done, a
     * repeating alarm moves to its next occurrence after this one.
     */
    public static AlarmRecord afterFiring(AlarmRecord current, Instant firedAt, ZoneId zone, boolean exactAllowed) {
        long fired = firedAt.toEpochMilli();
        if (current.spec.isOneOff()) {
            return new AlarmRecord(current.spec.withEnabled(false), AlarmRecord.Status.DONE, null, fired);
        }
        // Next after the occurrence that rang, even if delivery was a moment early.
        long scheduled = current.triggerAt != null ? current.triggerAt : fired;
        Instant from = Instant.ofEpochMilli(Math.max(fired, scheduled));
        Instant next = NextTrigger.after(current.spec, from, zone);
        if (!exactAllowed) {
            return new AlarmRecord(current.spec, AlarmRecord.Status.WAITING_FOR_PERMISSION, null, fired);
        }
        return new AlarmRecord(current.spec, AlarmRecord.Status.SCHEDULED, next == null ? null : next.toEpochMilli(), fired);
    }
}
