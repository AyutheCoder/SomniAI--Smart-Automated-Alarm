package app.somniai.alarm.alarms;

/** An alarm and what the phone last did with it. */
public final class AlarmRecord {

    public enum Status {
        /** Handed to AlarmManager for {@link #triggerAt}. */
        SCHEDULED,
        /** Saved, but exact alarms aren't allowed; scheduled when they are. */
        WAITING_FOR_PERMISSION,
        /** A one-off whose time passed while it couldn't ring (phone off, app force-stopped). */
        MISSED,
        /** A one-off that rang. */
        DONE,
        /** Turned off in the app. */
        DISABLED,
    }

    public final AlarmSpec spec;
    public final Status status;
    /** Epoch millis it is scheduled for, when {@link Status#SCHEDULED}. */
    public final Long triggerAt;
    /** Epoch millis it last rang, if ever. */
    public final Long lastFiredAt;
    /**
     * Set while a snooze from the ring screen is pending (prompt 5.1): the
     * alarm is SCHEDULED for this time instead of its own next occurrence, and
     * a reschedule keeps it. Null otherwise.
     */
    public final Long snoozedUntil;

    public AlarmRecord(AlarmSpec spec, Status status, Long triggerAt, Long lastFiredAt) {
        this(spec, status, triggerAt, lastFiredAt, null);
    }

    public AlarmRecord(AlarmSpec spec, Status status, Long triggerAt, Long lastFiredAt, Long snoozedUntil) {
        this.spec = spec;
        this.status = status;
        this.triggerAt = triggerAt;
        this.lastFiredAt = lastFiredAt;
        this.snoozedUntil = snoozedUntil;
    }
}
