package app.somniai.alarm.alarms;

import java.util.Map;

/**
 * A wake-buddy alert as it arrives in a push's data (lib/buddyAlerts.ts sends
 * it): who hasn't confirmed they're awake, the words to show, and the number
 * to call if they chose to share one. Pure; tested in BuddyAlertMessageTest.
 */
final class BuddyAlertMessage {

    static final String TYPE = "buddy_alert";

    final String name;
    final String title;
    final String body;
    /** Digits and a leading +, or null: no number shared, or not one. */
    final String phone;
    /** The ring's time, for one notification per ring. */
    final String alarmAt;

    private BuddyAlertMessage(String name, String title, String body, String phone, String alarmAt) {
        this.name = name;
        this.title = title;
        this.body = body;
        this.phone = phone;
        this.alarmAt = alarmAt;
    }

    /** Null for anything that isn't a well-formed buddy alert. */
    static BuddyAlertMessage from(Map<String, String> data) {
        if (data == null || !TYPE.equals(data.get("type"))) {
            return null;
        }
        String name = text(data.get("name"));
        String title = text(data.get("title"));
        String body = text(data.get("body"));
        if (name == null || title == null || body == null) {
            return null;
        }
        return new BuddyAlertMessage(name, title, body, phone(data.get("phone")), text(data.get("alarmAt")));
    }

    /** "tel:+447700900123" for the dialler, or null with no number. */
    String dialUri() {
        return phone == null ? null : "tel:" + phone;
    }

    /** One notification per ring: a retry replaces it rather than adding another. */
    int notificationId() {
        return 7100 + Math.floorMod((name + "|" + alarmAt).hashCode(), 1000);
    }

    private static String text(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() || t.length() > 500 ? null : t;
    }

    /** Only something the dialler can take, never a tel: URI with other parts in it. */
    private static String phone(String s) {
        if (s == null) {
            return null;
        }
        String p = s.trim();
        return p.matches("\\+?[0-9]{6,15}") ? p : null;
    }
}
