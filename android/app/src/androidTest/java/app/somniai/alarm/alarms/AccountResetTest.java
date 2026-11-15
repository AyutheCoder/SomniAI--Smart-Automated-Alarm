package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.AlarmManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Deleting the account (prompt 7.2), on a device: afterwards AlarmManager has
 * none of this app's alarms, and nothing about them, no unsent call and no
 * telemetry is left on the phone.
 */
@RunWith(AndroidJUnit4.class)
public class AccountResetTest {

    static final String A = "aaaaaaaaaaaaaaaaaaaaaaaa";
    static final String B = "bbbbbbbbbbbbbbbbbbbbbbbb";

    private Context context;
    private AlarmManager alarms;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        alarms = context.getSystemService(AlarmManager.class);
        Outbox.autoSync = false;
        AccountReset.forget(context);
    }

    @After
    public void tearDown() {
        AccountReset.forget(context);
        Outbox.autoSync = true;
    }

    private AlarmSpec inMinutes(String id, int minutes) {
        LocalDateTime t = LocalDateTime.now(ZoneId.systemDefault()).plusMinutes(minutes);
        return new AlarmSpec(id, "Account reset test", t.getHour(), t.getMinute(), EnumSet.noneOf(DayOfWeek.class), t.toLocalDate(), true, null);
    }

    private boolean ourAlarmIsNext() {
        AlarmManager.AlarmClockInfo next = alarms.getNextAlarmClock();
        return next != null && next.getShowIntent() != null && context.getPackageName().equals(next.getShowIntent().getCreatorPackage());
    }

    @Test
    public void forgetsEveryAlarmUnsentCallAndWake() throws Exception {
        AlarmScheduler.reconcile(context, List.of(inMinutes(A, 30), inMinutes(B, 45)));
        AlarmStore.log(context, AlarmScheduler.logEntry(A, "Account reset test", "rang", 1L, 2L, "test"));
        Outbox.enqueue(context, Collections.singletonList(new SyncCalls.Call(A, "/api/alarms/" + A + "/fire", new JSONObject().put("at", 1))));
        Telemetry.get(context).setConsent(true, "telemetry-v1", System.currentTimeMillis());
        PreflightProbe.setBedtime(context, System.currentTimeMillis() + 3_600_000L);
        assertTrue("before: AlarmManager has our alarm", ourAlarmIsNext());
        assertEquals(2, AlarmScheduler.list(context).size());

        JSONObject forgot = AccountReset.forget(context);

        assertEquals(2, forgot.getInt("alarms"));
        assertEquals(1, forgot.getInt("unsent"));
        assertFalse("after: AlarmManager has none of ours", ourAlarmIsNext());
        assertTrue(AlarmScheduler.list(context).isEmpty());
        assertEquals(0, AlarmStore.readLog(context).length());
        assertEquals(0, Outbox.queue(context).size());
        assertFalse(Telemetry.get(context).consent().granted);
        assertNull(PreflightProbe.bedtime(context));
    }

    @Test
    public void runsTwiceWithoutComplaint() {
        assertNotNull(AccountReset.forget(context));
        assertNotNull(AccountReset.forget(context));
    }
}
