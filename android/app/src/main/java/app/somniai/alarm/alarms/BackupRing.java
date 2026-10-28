package app.somniai.alarm.alarms;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.util.EnumSet;

/**
 * A ring started on this device because another of the user's devices reached
 * its backup level (prompt 3.3, lib/backupServer.ts). It rings like an alarm,
 * louder in steps, and stops with Stop: no wake check, since the one that
 * counts is on the device that rang first. It has **no backup level of its
 * own**, so two devices can never keep ringing each other. It isn't reported
 * to the server as a ring of its own. Pure; tested in BackupRingTest.
 */
final class BackupRing {

    static final String ID_PREFIX = "backup-";

    /** No check, four steps up to full volume, no backups. */
    static final String PLAN = "{\"version\":1,"
        + "\"challenge\":{\"required\":false,\"methods\":[\"math\"],\"minConfidence\":0},"
        + "\"sound\":{\"intensity\":100,\"strategy\":\"aggressive\"},"
        + "\"escalation\":["
        + "{\"level\":1,\"afterSeconds\":0,\"label\":\"Backup alarm\",\"volumeFactor\":1,\"vibrate\":false,\"requireVerification\":false,\"backup\":[]},"
        + "{\"level\":2,\"afterSeconds\":10,\"label\":\"Increased volume\",\"volumeFactor\":1.4,\"vibrate\":false,\"requireVerification\":false,\"backup\":[]},"
        + "{\"level\":3,\"afterSeconds\":20,\"label\":\"Continuous vibration\",\"volumeFactor\":1.6,\"vibrate\":true,\"requireVerification\":false,\"backup\":[]},"
        + "{\"level\":4,\"afterSeconds\":30,\"label\":\"Full volume\",\"volumeFactor\":1.8,\"vibrate\":true,\"requireVerification\":false,\"backup\":[]}"
        + "]}";

    private BackupRing() {}

    static AlarmSpec spec(String alarmId, String label, LocalDateTime now) {
        String name = label == null || label.trim().isEmpty() ? "Alarm" : label.trim();
        return new AlarmSpec(ID_PREFIX + alarmId, name + " (from your other device)", now.getHour(), now.getMinute(),
            EnumSet.noneOf(DayOfWeek.class), now.toLocalDate(), true, PLAN);
    }

    static boolean isBackup(String id) {
        return id != null && id.startsWith(ID_PREFIX);
    }

    /** Whether a stop for this alarm is for the ring with this id. */
    static boolean stops(String ringingId, String alarmId) {
        return alarmId != null && !alarmId.isEmpty() && (ID_PREFIX + alarmId).equals(ringingId);
    }
}
