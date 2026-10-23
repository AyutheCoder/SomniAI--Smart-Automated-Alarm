package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.EnumSet;
import org.json.JSONObject;
import org.junit.Test;

/** What the web app sends is checked; what is stored reads back the same. */
public class AlarmCodecTest {

    static JSONObject input(String json) throws Exception {
        return new JSONObject(json);
    }

    static void refused(String json, String reason) throws Exception {
        try {
            AlarmCodec.specFromJson(input(json));
            fail("accepted " + json);
        }
        catch (IllegalArgumentException e) {
            assertTrue(e.getMessage(), e.getMessage().contains(reason));
        }
    }

    @Test
    public void daysUseTheWebAppsNumberingWithSundayAsZero() throws Exception {
        AlarmSpec a = AlarmCodec.specFromJson(input("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"days\":[0,6,1,1]}"));
        assertEquals(EnumSet.of(DayOfWeek.SUNDAY, DayOfWeek.SATURDAY, DayOfWeek.MONDAY), a.days);
        assertNull(a.date);
        assertTrue(a.enabled);
    }

    @Test
    public void aOneOffHasADate() throws Exception {
        AlarmSpec a = AlarmCodec.specFromJson(input("{\"id\":\"x\",\"label\":\"Flight\",\"hour\":4,\"minute\":45,\"date\":\"2026-10-25\",\"enabled\":false}"));
        assertEquals(LocalDate.of(2026, 10, 25), a.date);
        assertEquals("Flight", a.label);
        assertEquals(false, a.enabled);
    }

    @Test
    public void aRecordReadsBackTheSameIncludingTheRingPlan() throws Exception {
        AlarmSpec spec = AlarmCodec.specFromJson(input(
            "{\"id\":\"64f0\",\"label\":\"Gym\",\"hour\":6,\"minute\":30,\"days\":[1,2,3,4,5],"
                + "\"ringPlan\":{\"version\":1,\"critical\":true,\"escalation\":[{\"level\":1,\"afterSeconds\":0}]}}"));
        AlarmRecord record = new AlarmRecord(spec, AlarmRecord.Status.SCHEDULED, 1793341800000L, null);
        AlarmRecord back = AlarmCodec.recordFromJson(new JSONObject(AlarmCodec.recordToJson(record).toString()));
        assertEquals("64f0", back.spec.id);
        assertEquals("Gym", back.spec.label);
        assertEquals(6, back.spec.hour);
        assertEquals(30, back.spec.minute);
        assertNull(back.spec.date);
        assertTrue(back.spec.enabled);
        assertEquals(AlarmRecord.Status.SCHEDULED, back.status);
        assertEquals(Long.valueOf(1793341800000L), back.triggerAt);
        assertNull(back.lastFiredAt);
        assertEquals(true, new JSONObject(back.spec.ringPlanJson).getBoolean("critical"));
        assertEquals(EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.FRIDAY), back.spec.days);
    }

    @Test
    public void dayNumbersMapBothWays() throws Exception {
        for (int d = 0; d <= 6; d++) {
            assertEquals(d, AlarmCodec.toWebDay(AlarmCodec.fromWebDay(d)));
        }
        assertEquals(DayOfWeek.SUNDAY, AlarmCodec.fromWebDay(0));
    }

    @Test
    public void malformedAlarmsAreRefusedWithAReason() throws Exception {
        refused("{\"hour\":7,\"minute\":0,\"days\":[1]}", "id");
        refused("{\"id\":\"  \",\"hour\":7,\"minute\":0,\"days\":[1]}", "id");
        refused("{\"id\":\"x\",\"hour\":24,\"minute\":0,\"days\":[1]}", "hour");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":-1,\"days\":[1]}", "minute");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":\"5\",\"days\":[1]}", "minute");
        refused("{\"id\":\"x\",\"hour\":7.5,\"minute\":0,\"days\":[1]}", "hour");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"days\":[7]}", "days");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0}", "either a date");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"days\":[]}", "either a date");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"days\":[1],\"date\":\"2026-10-25\"}", "not both");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"date\":\"25/10/2026\"}", "YYYY-MM-DD");
        refused("{\"id\":\"x\",\"hour\":7,\"minute\":0,\"date\":\"2026-02-30\"}", "YYYY-MM-DD");
        refused("{\"id\":\"x\",\"label\":\"" + "a".repeat(201) + "\",\"hour\":7,\"minute\":0,\"days\":[1]}", "label");
    }
}
