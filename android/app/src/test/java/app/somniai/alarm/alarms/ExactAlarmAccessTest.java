package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.somniai.alarm.alarms.ExactAlarmAccess.State;
import org.junit.Test;

/** Every Android version from 8 (API 26) to 16 (API 36). */
public class ExactAlarmAccessTest {

    @Test
    public void android8To11NeedNoPermission() {
        for (int sdk = 26; sdk <= 30; sdk++) {
            assertEquals(State.NOT_REQUIRED, ExactAlarmAccess.decide(sdk, false));
            assertEquals(State.NOT_REQUIRED, ExactAlarmAccess.decide(sdk, true));
            assertNull(ExactAlarmAccess.permissionFor(sdk));
            assertTrue(ExactAlarmAccess.canSchedule(ExactAlarmAccess.decide(sdk, false)));
        }
    }

    @Test
    public void android12UsesTheUserControlledAccess() {
        for (int sdk = 31; sdk <= 32; sdk++) {
            assertEquals("android.permission.SCHEDULE_EXACT_ALARM", ExactAlarmAccess.permissionFor(sdk));
            assertEquals(State.GRANTED, ExactAlarmAccess.decide(sdk, true));
            assertEquals("turned off: the user can turn it on", State.NEEDS_USER, ExactAlarmAccess.decide(sdk, false));
            assertFalse(ExactAlarmAccess.canSchedule(State.NEEDS_USER));
        }
    }

    @Test
    public void android13AndUpUseTheAlarmClockPermission() {
        for (int sdk = 33; sdk <= 36; sdk++) {
            assertEquals("android.permission.USE_EXACT_ALARM", ExactAlarmAccess.permissionFor(sdk));
            assertEquals(State.GRANTED, ExactAlarmAccess.decide(sdk, true));
            // Not expected (granted at install, not revocable), but said plainly if it happens.
            assertEquals(State.UNAVAILABLE, ExactAlarmAccess.decide(sdk, false));
            assertFalse(ExactAlarmAccess.canSchedule(State.UNAVAILABLE));
        }
    }
}
