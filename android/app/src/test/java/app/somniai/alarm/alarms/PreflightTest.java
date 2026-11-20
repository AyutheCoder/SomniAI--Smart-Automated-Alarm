package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.Preflight.Brand;
import app.somniai.alarm.alarms.Preflight.Check;
import app.somniai.alarm.alarms.Preflight.Dnd;
import app.somniai.alarm.alarms.Preflight.Facts;
import app.somniai.alarm.alarms.Preflight.Fix;
import app.somniai.alarm.alarms.Preflight.Status;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** The bedtime check's decisions: every check, every branch. */
public class PreflightTest {

    static Check check(Facts f, String id) {
        for (Check c : Preflight.run(f)) {
            if (c.id.equals(id)) {
                return c;
            }
        }
        throw new AssertionError("no check " + id);
    }

    static Facts phone(String manufacturer, String brand) {
        Facts f = new Facts();
        f.manufacturer = manufacturer;
        f.brand = brand;
        return f;
    }

    @Test
    public void aPhoneWithEverythingRightPassesEveryCheckInOrder() {
        List<Check> checks = Preflight.run(new Facts());
        List<String> ids = new ArrayList<>();
        for (Check c : checks) {
            ids.add(c.id);
            assertEquals(c.id, Status.PASS, c.status);
            assertNull(c.id + ": no button when it passes", c.fixLabel);
        }
        assertEquals(List.of("exact_alarm", "notifications", "full_screen", "battery_optimization", "manufacturer",
            "alarm_volume", "dnd", "battery"), ids);
        assertEquals(0, Preflight.attention(checks));
    }

    // --- exact alarms ---

    @Test
    public void exactAlarms() {
        Facts f = new Facts();
        f.exactAlarm = ExactAlarmAccess.State.NOT_REQUIRED;
        assertEquals(Status.PASS, check(f, "exact_alarm").status);
        f.exactAlarm = ExactAlarmAccess.State.GRANTED;
        assertEquals(Status.PASS, check(f, "exact_alarm").status);

        f.exactAlarm = ExactAlarmAccess.State.NEEDS_USER;
        Check c = check(f, "exact_alarm");
        assertEquals(Status.FAIL, c.status);
        assertEquals(Fix.EXACT_ALARM_SETTINGS, c.fix);
        assertEquals("Allow", c.fixLabel);

        f.exactAlarm = ExactAlarmAccess.State.UNAVAILABLE;
        c = check(f, "exact_alarm");
        assertEquals(Status.FAIL, c.status);
        assertEquals("no setting to send the user to", Fix.NONE, c.fix);
        assertNull(c.fixLabel);
    }

    // --- notifications and the full-screen alarm ---

    @Test
    public void notificationsOffFail() {
        Facts f = new Facts();
        f.notifications = false;
        Check c = check(f, "notifications");
        assertEquals(Status.FAIL, c.status);
        assertEquals(Fix.NOTIFICATION_SETTINGS, c.fix);
    }

    @Test
    public void theFullScreenAlarm() {
        Facts f = new Facts();
        f.fullScreen = null;
        assertEquals("below Android 14 it's always allowed", Status.PASS, check(f, "full_screen").status);
        f.fullScreen = false;
        Check c = check(f, "full_screen");
        assertEquals(Status.FAIL, c.status);
        assertEquals(Fix.FULL_SCREEN_SETTINGS, c.fix);
    }

    // --- battery optimisation and the manufacturer's manager ---

    static final String[][] MANAGED = {
        { "Xiaomi", "POCO" }, { "Xiaomi", "Redmi" }, { "Xiaomi", "Xiaomi" }, { "realme", "realme" }, { "OPPO", "OPPO" },
        { "vivo", "vivo" }, { "vivo", "iQOO" }, { "samsung", "samsung" }, { "OnePlus", "OnePlus" },
    };

    @Test
    public void batteryOptimisationFailsOnlyWhereAManufacturerManagerActsOnIt() {
        Facts stock = new Facts();
        stock.ignoringBatteryOptimizations = false;
        Check c = check(stock, "battery_optimization");
        assertEquals("stock Android delivers alarm-clock alarms anyway", Status.PASS, c.status);

        for (String[] m : MANAGED) {
            Facts f = phone(m[0], m[1]);
            f.ignoringBatteryOptimizations = false;
            c = check(f, "battery_optimization");
            assertEquals(m[1], Status.FAIL, c.status);
            assertEquals(Fix.BATTERY_OPTIMIZATION_SETTINGS, c.fix);
            assertEquals(1, c.steps.size());
            f.ignoringBatteryOptimizations = true;
            assertEquals(m[1], Status.PASS, check(f, "battery_optimization").status);
        }
        Facts samsung = phone("samsung", "samsung");
        assertTrue(check(samsung, "battery_optimization").steps.get(0).contains("Unrestricted"));
    }

    @Test
    public void aManufacturerManagerIsNeverReportedAsPassingBecauseItCantBeRead() {
        for (String[] m : MANAGED) {
            Facts f = phone(m[0], m[1]);
            // Everything else as good as it gets: still not a pass.
            f.ignoringBatteryOptimizations = true;
            Check c = check(f, "manufacturer");
            assertEquals(m[1], Status.UNVERIFIED, c.status);
            assertTrue(c.needsAttention());
            assertEquals(Fix.MANUFACTURER_SETTINGS, c.fix);
            assertTrue(m[1] + " has steps", c.steps.size() >= 2);
            assertTrue(c.title, c.title.startsWith(Preflight.name(Preflight.brandOf(m[0], m[1]))));

            f.managerConfirmed = true;
            c = check(f, "manufacturer");
            assertEquals("the user's word, shown as theirs", Status.CONFIRMED, c.status);
            assertNotEquals(Status.PASS, c.status);
            assertFalse(c.needsAttention());
        }
        Check stock = check(new Facts(), "manufacturer");
        assertEquals(Status.PASS, stock.status);
        assertTrue(stock.steps.isEmpty());
    }

    @Test
    public void everyManagedBrandHasItsOwnSteps() {
        for (Brand b : Brand.values()) {
            List<String> steps = Preflight.managerSteps(b);
            assertEquals(b.name(), b == Brand.OTHER, steps.isEmpty());
        }
        assertTrue(Preflight.managerSteps(Brand.XIAOMI).get(0).contains("Background autostart"));
        assertTrue(Preflight.managerSteps(Brand.SAMSUNG).get(0).contains("Put unused apps to sleep"));
        assertTrue(Preflight.managerSteps(Brand.ONEPLUS).get(0).contains("Sleep standby"));
        assertTrue(Preflight.managerSteps(Brand.VIVO).get(0).contains("Autostart"));
        assertTrue(Preflight.managerSteps(Brand.REALME).get(2).contains("Display over other apps"));
    }

    @Test
    public void brands() {
        Object[][] cases = {
            { "Xiaomi", "POCO", Brand.XIAOMI }, { "Xiaomi", "Redmi", Brand.XIAOMI },
            { "realme", "realme", Brand.REALME }, { "OPPO", "realme", Brand.REALME },
            { "OnePlus", "OnePlus", Brand.ONEPLUS }, { "OPPO", "OnePlus", Brand.ONEPLUS },
            { "OPPO", "OPPO", Brand.OPPO }, { "vivo", "iQOO", Brand.VIVO }, { "vivo", "vivo", Brand.VIVO },
            { "samsung", "samsung", Brand.SAMSUNG }, { "Google", "google", Brand.OTHER },
            { "motorola", "motorola", Brand.OTHER }, { null, null, Brand.OTHER },
        };
        for (Object[] c : cases) {
            assertEquals(c[0] + "/" + c[1], c[2], Preflight.brandOf((String) c[0], (String) c[1]));
        }
    }

    // --- alarm volume ---

    @Test
    public void alarmVolumeMustBeAboveZero() {
        Facts f = new Facts();
        f.alarmVolume = 0;
        Check c = check(f, "alarm_volume");
        assertEquals(Status.FAIL, c.status);
        assertEquals(Fix.RAISE_ALARM_VOLUME, c.fix);
        f.alarmVolume = -1;
        assertEquals(Status.FAIL, check(f, "alarm_volume").status);
        f.alarmVolume = 1;
        assertEquals(Status.PASS, check(f, "alarm_volume").status);
        assertEquals("1 of 7.", check(f, "alarm_volume").detail);

        // Where apps are told the stream stops at 3 (this POCO), anything up to 3 is right down.
        f.alarmVolumeMin = 3;
        f.alarmVolumeMax = 15;
        for (int v = 0; v <= 3; v++) {
            f.alarmVolume = v;
            assertEquals("volume " + v, Status.FAIL, check(f, "alarm_volume").status);
        }
        f.alarmVolume = 1;
        assertEquals("says the real number", "Turned right down (1 of 15). SomniAI tries to raise it when it rings, but don't rely on that.",
            check(f, "alarm_volume").detail);
        f.alarmVolume = 4;
        assertEquals(Status.PASS, check(f, "alarm_volume").status);
    }

    // --- Do Not Disturb ---

    @Test
    public void doNotDisturb() {
        Object[][] cases = {
            // mode, allows alarms, expected
            { Dnd.TOTAL_SILENCE, true, Status.FAIL }, { Dnd.TOTAL_SILENCE, null, Status.FAIL },
            { Dnd.ALARMS_ONLY, false, Status.PASS }, { Dnd.ALARMS_ONLY, null, Status.PASS },
            { Dnd.PRIORITY, true, Status.PASS }, { Dnd.PRIORITY, false, Status.FAIL }, { Dnd.PRIORITY, null, Status.UNVERIFIED },
            // Off now, but would silence alarms when a schedule turns it on.
            { Dnd.OFF, false, Status.FAIL }, { Dnd.OFF, true, Status.PASS }, { Dnd.OFF, null, Status.PASS },
        };
        for (Object[] c : cases) {
            Facts f = new Facts();
            f.dnd = (Dnd) c[0];
            f.dndAllowsAlarms = (Boolean) c[1];
            Check d = check(f, "dnd");
            assertEquals(c[0] + "/" + c[1], c[2], d.status);
            assertEquals(c[0] + "/" + c[1], d.status == Status.PASS ? Fix.NONE : Fix.DND_SETTINGS, d.fix);
        }
    }

    // --- battery ---

    @Test
    public void batteryLevelAndCharging() {
        Object[][] cases = {
            // percent, charging, expected
            { 80, false, Status.PASS }, { 25, false, Status.PASS }, { 24, false, Status.FAIL }, { 0, false, Status.FAIL },
            { 5, true, Status.PASS }, { 100, true, Status.PASS }, { -1, false, Status.UNVERIFIED }, { -1, true, Status.UNVERIFIED },
        };
        for (Object[] c : cases) {
            Facts f = new Facts();
            f.batteryPercent = (Integer) c[0];
            f.charging = (Boolean) c[1];
            Check b = check(f, "battery");
            assertEquals(c[0] + "/" + c[1], c[2], b.status);
            assertEquals("nothing to tap: plugging in is the fix", Fix.NONE, b.fix);
        }
        Facts low = new Facts();
        low.batteryPercent = 12;
        assertTrue(check(low, "battery").detail.contains("Plug in"));
    }

    // --- all together ---

    @Test
    public void attentionCountsFailuresAndUnreadSettingsButNotTheUsersWord() {
        Facts f = phone("Xiaomi", "POCO");
        f.exactAlarm = ExactAlarmAccess.State.NEEDS_USER;
        f.notifications = false;
        f.fullScreen = false;
        f.alarmVolume = 0;
        f.dnd = Dnd.TOTAL_SILENCE;
        f.batteryPercent = 10;
        List<Check> checks = Preflight.run(f);
        // Everything but nothing: all 8 (battery optimisation fails on Xiaomi; the manager is unverified).
        assertEquals(8, Preflight.attention(checks));
        for (Check c : checks) {
            assertTrue(c.id, c.needsAttention());
        }
        f.managerConfirmed = true;
        assertEquals(7, Preflight.attention(Preflight.run(f)));
    }

    @Test
    public void everyFailureSaysWhatToDo() {
        Facts f = phone("samsung", "samsung");
        f.exactAlarm = ExactAlarmAccess.State.NEEDS_USER;
        f.notifications = false;
        f.fullScreen = false;
        f.alarmVolume = 0;
        f.dnd = Dnd.PRIORITY;
        f.dndAllowsAlarms = false;
        f.batteryPercent = 10;
        for (Check c : Preflight.run(f)) {
            assertTrue(c.id + ": a button or steps or words", c.fixLabel != null || !c.steps.isEmpty() || c.detail.contains("Plug in"));
            assertFalse(c.id, c.detail.isEmpty());
        }
    }
}
