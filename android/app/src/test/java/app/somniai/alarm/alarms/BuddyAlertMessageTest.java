package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/** A wake-buddy push, as lib/buddyAlerts.ts sends it. */
public class BuddyAlertMessageTest {

    static Map<String, String> alert() {
        Map<String, String> d = new HashMap<>();
        d.put("type", "buddy_alert");
        d.put("name", "Sam");
        d.put("label", "Flight");
        d.put("alarmAt", "2026-10-28T07:00:00.000Z");
        d.put("minutes", "15");
        d.put("title", "Sam hasn't confirmed they're awake");
        d.put("body", "Their \"Flight\" alarm went off 15 minutes ago and SomniAI hasn't heard back.");
        return d;
    }

    @Test
    public void readsTheAlert() {
        BuddyAlertMessage m = BuddyAlertMessage.from(alert());
        assertNotNull(m);
        assertEquals("Sam", m.name);
        assertEquals("Sam hasn't confirmed they're awake", m.title);
        assertNull("no number shared: no call button", m.dialUri());
    }

    @Test
    public void aSharedNumberBecomesTheCallButton() {
        Map<String, String> d = alert();
        d.put("phone", "+447700900123");
        assertEquals("tel:+447700900123", BuddyAlertMessage.from(d).dialUri());
    }

    @Test
    public void onlyANumberEverReachesTheDialler() {
        for (String bad : new String[] { "", "12345", "+44 7700 900123", "tel:123456789", "123456789;ext=1", "1234567890123456", "*21*123456#" }) {
            Map<String, String> d = alert();
            d.put("phone", bad);
            assertNull(bad, BuddyAlertMessage.from(d).dialUri());
        }
    }

    @Test
    public void anythingElseIsIgnored() {
        assertNull(BuddyAlertMessage.from(null));
        assertNull(BuddyAlertMessage.from(new HashMap<>()));
        Map<String, String> other = alert();
        other.put("type", "marketing");
        assertNull(other.get("type"), BuddyAlertMessage.from(other));
        for (String field : new String[] { "name", "title", "body" }) {
            Map<String, String> d = alert();
            d.remove(field);
            assertNull("without " + field, BuddyAlertMessage.from(d));
            d.put(field, "   ");
            assertNull("blank " + field, BuddyAlertMessage.from(d));
        }
    }

    @Test
    public void oneNotificationPerRing() {
        BuddyAlertMessage a = BuddyAlertMessage.from(alert());
        assertEquals("a retry replaces it", a.notificationId(), BuddyAlertMessage.from(alert()).notificationId());
        Map<String, String> later = alert();
        later.put("alarmAt", "2026-10-29T07:00:00.000Z");
        assertNotEquals("another ring is another notification", a.notificationId(), BuddyAlertMessage.from(later).notificationId());
        assertNotEquals("never the alarm's own notifications", 7001, a.notificationId());
        assertNotEquals(7002, a.notificationId());
    }
}
