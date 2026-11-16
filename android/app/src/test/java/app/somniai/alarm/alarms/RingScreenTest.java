package app.somniai.alarm.alarms;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RingScreenTest {

    @Test
    public void opensTheRingScreenWhenThePhoneIsInUse() {
        // The case found on the POCO: unlocked, SomniAI open, no ring screen.
        assertTrue(RingScreen.openDirectly(true, false, false));
    }

    @Test
    public void leavesALockedOrSleepingPhoneToTheFullScreenIntent() {
        assertFalse(RingScreen.openDirectly(true, true, false));
        assertFalse(RingScreen.openDirectly(false, true, false));
        assertFalse(RingScreen.openDirectly(false, false, false));
    }

    @Test
    public void doesNotReopenAScreenAlreadyInFront() {
        assertFalse(RingScreen.openDirectly(true, false, true));
    }
}
