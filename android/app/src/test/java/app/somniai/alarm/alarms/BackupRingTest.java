package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.time.LocalDateTime;
import org.junit.Test;

/** A ring started here because another device reached its backup level. */
public class BackupRingTest {

    static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 28, 7, 1);

    @Test
    public void itIsAnAlarmForNowNamedForWhereItCameFrom() {
        AlarmSpec spec = BackupRing.spec("6ae1d8e5e4ef0b6b1f43fda1", "Flight", NOW);
        assertEquals("backup-6ae1d8e5e4ef0b6b1f43fda1", spec.id);
        assertEquals("Flight (from your other device)", spec.label);
        assertTrue(spec.enabled);
        assertEquals("Alarm (from your other device)", BackupRing.spec("x", "  ", NOW).label);
        assertTrue(BackupRing.isBackup(spec.id));
        assertFalse(BackupRing.isBackup("6ae1d8e5e4ef0b6b1f43fda1"));
        assertFalse(BackupRing.isBackup(null));
    }

    @Test
    public void itStopsWithStopAndNeverRingsAnotherDevice() {
        AlarmSpec spec = BackupRing.spec("a1", "Flight", NOW);
        assertFalse("no wake check here: that's on the device that rang first", WakeCheck.Plan.fromRingPlan(spec.ringPlanJson).required);
        EscalationLadder ladder = EscalationLadder.fromRingPlan(spec.ringPlanJson);
        assertEquals("its own ladder, from the plan", "plan", ladder.source);
        for (EscalationLadder.Level l : ladder.levels) {
            assertTrue("no backups at level " + l.level + ": two devices can't keep ringing each other", l.backup.isEmpty());
            assertFalse(l.requireVerification);
        }
        assertEquals(4, ladder.levels.size());
        assertEquals(1.8, ladder.levels.get(3).volumeFactor, 0);
    }

    @Test
    public void aStopReachesOnlyTheBackupRingForThatAlarm() {
        assertTrue(BackupRing.stops("backup-a1", "a1"));
        assertFalse("this device's own alarm a1", BackupRing.stops("a1", "a1"));
        assertFalse(BackupRing.stops("backup-a1", "a2"));
        assertFalse(BackupRing.stops("backup-a1", ""));
        assertFalse(BackupRing.stops("backup-a1", null));
    }
}
