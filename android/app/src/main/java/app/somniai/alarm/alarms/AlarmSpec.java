package app.somniai.alarm.alarms;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

/**
 * An alarm as the phone keeps it: a wall-clock time, not an instant.
 *
 * "07:00 on weekdays" stays 07:00 local through daylight-saving changes and
 * after the phone moves to another time zone, the way a bedside clock does.
 * The instant it rings at is worked out from this by {@link NextTrigger}
 * whenever it is scheduled.
 *
 * Exactly one of {@code days} (repeats on those days) and {@code date}
 * (rings once, on that date) is set; {@link AlarmCodec} enforces it.
 */
public final class AlarmSpec {

    public final String id;
    public final String label;
    public final int hour;
    public final int minute;
    /** Days it repeats on; empty for a one-off alarm. */
    public final Set<DayOfWeek> days;
    /** The date a one-off alarm rings on; null for a repeating alarm. */
    public final LocalDate date;
    public final boolean enabled;
    /** The web app's ring plan (lib/ringPlan.ts), kept as JSON for ringing offline. */
    public final String ringPlanJson;

    public AlarmSpec(String id, String label, int hour, int minute, Set<DayOfWeek> days, LocalDate date, boolean enabled, String ringPlanJson) {
        this.id = id;
        this.label = label;
        this.hour = hour;
        this.minute = minute;
        this.days = days.isEmpty() ? Collections.unmodifiableSet(EnumSet.noneOf(DayOfWeek.class)) : Collections.unmodifiableSet(EnumSet.copyOf(days));
        this.date = date;
        this.enabled = enabled;
        this.ringPlanJson = ringPlanJson;
    }

    public boolean isOneOff() {
        return date != null;
    }

    public AlarmSpec withEnabled(boolean value) {
        return new AlarmSpec(id, label, hour, minute, days, date, value, ringPlanJson);
    }

    /** Whether the two describe the same alarm: everything the web app sets. */
    public boolean sameDefinition(AlarmSpec o) {
        return o != null
            && id.equals(o.id)
            && label.equals(o.label)
            && hour == o.hour
            && minute == o.minute
            && days.equals(o.days)
            && java.util.Objects.equals(date, o.date)
            && enabled == o.enabled
            && java.util.Objects.equals(ringPlanJson, o.ringPlanJson);
    }
}
