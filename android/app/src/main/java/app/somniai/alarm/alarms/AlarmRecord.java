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

    public AlarmRecord(AlarmSpec spec, Status status, Long triggerAt, Long lastFiredAt) {
        this.spec = spec;
        this.status = status;
        this.triggerAt = triggerAt;
        this.lastFiredAt = lastFiredAt;
    }
}
