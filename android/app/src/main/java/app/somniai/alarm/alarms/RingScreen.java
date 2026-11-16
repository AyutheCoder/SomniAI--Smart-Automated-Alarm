package app.somniai.alarm.alarms;

/**
 * When the ringing service opens the ring screen itself (prompt 7.5, found on the
 * POCO with the first Firebase build). Pure, JVM-tested.
 *
 * The full-screen intent opens the ring screen only while the phone is locked or
 * asleep. With the phone in use, Android shows the alarm as a heads-up banner
 * instead, and Xiaomi hides banners from a newly installed app ("Floating
 * notifications" off): the alarm rang, escalated to its wake check, and there
 * was nowhere to answer it. So, while the phone is awake and unlocked and the
 * ring screen isn't already in front, the service opens it directly. Android
 * lets it whenever SomniAI is in front (the case seen); from another app it may
 * still block the start, and the notification remains the way in.
 */
final class RingScreen {

    private RingScreen() {
    }

    /** Whether to open the ring screen directly, rather than leave it to the full-screen intent. */
    static boolean openDirectly(boolean interactive, boolean locked, boolean alreadyShowing) {
        return interactive && !locked && !alreadyShowing;
    }
}
