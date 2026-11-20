package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * The bedtime pre-flight check: everything that can silently stop tonight's
 * alarm, each with a verdict and a fix. Pure: the phone's state comes in as
 * {@link Facts} ({@link PreflightProbe} reads them), so every decision is
 * tested on the JVM (PreflightTest).
 *
 * A setting the phone can't read is never reported as passing: it is
 * {@link Status#UNVERIFIED} until the user says they've done it
 * ({@link Status#CONFIRMED}), which is shown as their word, not a reading.
 */
final class Preflight {

    enum Status { PASS, FAIL, UNVERIFIED, CONFIRMED }

    /** Brands with their own battery manager on top of Android's (dontkillmyapp.com). */
    enum Brand { XIAOMI, REALME, OPPO, VIVO, SAMSUNG, ONEPLUS, OTHER }

    enum Dnd { OFF, PRIORITY, ALARMS_ONLY, TOTAL_SILENCE }

    /** What the fix button does; PreflightActivity carries it out. */
    enum Fix {
        NONE,
        EXACT_ALARM_SETTINGS,
        NOTIFICATION_SETTINGS,
        FULL_SCREEN_SETTINGS,
        BATTERY_OPTIMIZATION_SETTINGS,
        MANUFACTURER_SETTINGS,
        RAISE_ALARM_VOLUME,
        DND_SETTINGS,
    }

    /** Unplugged and below this, the battery could run out before the alarm. */
    static final int LOW_BATTERY_PERCENT = 25;

    /** The phone's state. Defaults are a phone where everything passes. */
    static final class Facts {
        int sdk = 34;
        String manufacturer = "Google";
        String brand = "google";
        ExactAlarmAccess.State exactAlarm = ExactAlarmAccess.State.GRANTED;
        boolean notifications = true;
        /** Android 14+ only; null below, where it is always allowed. */
        Boolean fullScreen = true;
        boolean ignoringBatteryOptimizations = false;
        /** The user said they changed the brand's own settings. */
        boolean managerConfirmed = false;
        int alarmVolume = 5;
        /**
         * The lowest the alarm stream goes, as Android reports it to apps: 0 on
         * some phones; on many it is above the system's own minimum (this POCO
         * reports 3 to apps, of 15, though its slider goes to 1).
         */
        int alarmVolumeMin = 0;
        int alarmVolumeMax = 7;
        Dnd dnd = Dnd.OFF;
        /** Whether Do Not Disturb's priority mode lets alarms through; null if it couldn't be read. */
        Boolean dndAllowsAlarms = true;
        /** 0 to 100; -1 if it couldn't be read. */
        int batteryPercent = 80;
        boolean charging = false;
    }

    static final class Check {
        final String id;
        final Status status;
        final String title;
        final String detail;
        final Fix fix;
        /** The fix button's text, or null for no button. */
        final String fixLabel;
        /** Steps to follow by hand, for settings an app can't change. */
        final List<String> steps;

        Check(String id, Status status, String title, String detail, Fix fix, String fixLabel, List<String> steps) {
            this.id = id;
            this.status = status;
            this.title = title;
            this.detail = detail;
            this.fix = fix;
            this.fixLabel = fixLabel;
            this.steps = steps;
        }

        boolean needsAttention() {
            return status == Status.FAIL || status == Status.UNVERIFIED;
        }
    }

    private Preflight() {}

    static List<Check> run(Facts f) {
        Brand brand = brandOf(f.manufacturer, f.brand);
        List<Check> out = new ArrayList<>();
        out.add(exactAlarm(f));
        out.add(notifications(f));
        out.add(fullScreen(f));
        out.add(batteryOptimization(f, brand));
        out.add(manufacturer(f, brand));
        out.add(alarmVolume(f));
        out.add(doNotDisturb(f));
        out.add(battery(f));
        return out;
    }

    static int attention(List<Check> checks) {
        int n = 0;
        for (Check c : checks) {
            if (c.needsAttention()) {
                n++;
            }
        }
        return n;
    }

    static Check exactAlarm(Facts f) {
        String title = "Alarms & reminders";
        switch (f.exactAlarm) {
            case NOT_REQUIRED:
                return pass("exact_alarm", title, "Not needed on this version of Android.");
            case GRANTED:
                return pass("exact_alarm", title, "Allowed: alarms are set for the exact minute.");
            case NEEDS_USER:
                return fail("exact_alarm", title, "Turned off for SomniAI, so it can't set alarms for an exact time.",
                    Fix.EXACT_ALARM_SETTINGS, "Allow");
            default:
                return fail("exact_alarm", title, "Android refuses SomniAI exact alarms, and there is no setting for it on this phone. "
                    + "Reinstalling SomniAI usually restores it.", Fix.NONE, null);
        }
    }

    static Check notifications(Facts f) {
        String title = "Notifications";
        return f.notifications
            ? pass("notifications", title, "On: the alarm can show its screen and Stop button.")
            : fail("notifications", title, "Off: the alarm still sounds, but its screen and Stop button may not appear.",
                Fix.NOTIFICATION_SETTINGS, "Turn on");
    }

    static Check fullScreen(Facts f) {
        String title = "Alarm screen over the lock screen";
        if (f.fullScreen == null) {
            return pass("full_screen", title, "Always allowed on this version of Android.");
        }
        return f.fullScreen
            ? pass("full_screen", title, "Allowed.")
            : fail("full_screen", title, "Not allowed: the alarm shows only as a notification, not on the whole screen.",
                Fix.FULL_SCREEN_SETTINGS, "Allow");
    }

    /**
     * Android delivers alarm-clock alarms through battery optimisation (its
     * Doze documentation; the device matrix, emulator and phone). It matters
     * where a manufacturer's own manager stops optimised apps.
     */
    static Check batteryOptimization(Facts f, Brand brand) {
        String title = "Battery optimisation";
        if (f.ignoringBatteryOptimizations) {
            return pass("battery_optimization", title, "SomniAI isn't optimised.");
        }
        if (brand == Brand.OTHER) {
            return pass("battery_optimization", title,
                "SomniAI is optimised, which is fine on this phone: Android still delivers alarm-clock alarms on time.");
        }
        List<String> steps = new ArrayList<>();
        steps.add(brand == Brand.SAMSUNG
            ? "Find SomniAI and choose \"Unrestricted\"."
            : "Switch the list to \"All apps\", find SomniAI and choose \"Don't optimise\" (or \"Not optimised\").");
        return new Check("battery_optimization", Status.FAIL, title,
            "SomniAI is optimised. " + name(brand) + "'s battery manager can close optimised apps overnight.",
            Fix.BATTERY_OPTIMIZATION_SETTINGS, "Open settings", steps);
    }

    static Check manufacturer(Facts f, Brand brand) {
        if (brand == Brand.OTHER) {
            return pass("manufacturer", "Phone maker's battery manager", "This phone has no extra battery manager that SomniAI knows of.");
        }
        String title = name(brand) + "'s background settings";
        List<String> steps = managerSteps(brand);
        if (f.managerConfirmed) {
            return new Check("manufacturer", Status.CONFIRMED, title,
                "You marked these done. SomniAI can't read them, so check again after a system update.",
                Fix.MANUFACTURER_SETTINGS, "Open settings", steps);
        }
        return new Check("manufacturer", Status.UNVERIFIED, title,
            "SomniAI can't read these settings. Follow the steps once, then mark them done.",
            Fix.MANUFACTURER_SETTINGS, "Open settings", steps);
    }

    /**
     * "Above zero", where zero is the stream's lowest setting: many phones
     * stop the alarm stream at 1, which is as good as off for waking.
     */
    static Check alarmVolume(Facts f) {
        String title = "Alarm volume";
        if (f.alarmVolume <= Math.max(0, f.alarmVolumeMin)) {
            return fail("alarm_volume", title,
                "Turned right down (" + Math.max(0, f.alarmVolume) + " of " + f.alarmVolumeMax + "). SomniAI tries to raise it when it rings, but don't rely on that.",
                Fix.RAISE_ALARM_VOLUME, "Turn up");
        }
        return pass("alarm_volume", title, f.alarmVolume + " of " + f.alarmVolumeMax + ".");
    }

    static Check doNotDisturb(Facts f) {
        String title = "Do Not Disturb";
        switch (f.dnd) {
            case TOTAL_SILENCE:
                return fail("dnd", title, "On, set to total silence: Android mutes every alarm.", Fix.DND_SETTINGS, "Open settings");
            case ALARMS_ONLY:
                return pass("dnd", title, "On, alarms only: alarms still ring.");
            case PRIORITY:
                if (f.dndAllowsAlarms == null) {
                    return new Check("dnd", Status.UNVERIFIED, title,
                        "On. SomniAI can't read whether it lets alarms through: check that alarms are allowed.",
                        Fix.DND_SETTINGS, "Open settings", Collections.singletonList("Under what can interrupt, turn on \"Alarms\"."));
                }
                return f.dndAllowsAlarms
                    ? pass("dnd", title, "On, and alarms are allowed through.")
                    : new Check("dnd", Status.FAIL, title, "On, and set to silence alarms.", Fix.DND_SETTINGS, "Open settings",
                        Collections.singletonList("Under what can interrupt, turn on \"Alarms\"."));
            default:
                if (Boolean.FALSE.equals(f.dndAllowsAlarms)) {
                    return new Check("dnd", Status.FAIL, title,
                        "Off now, but set to silence alarms when it turns on, for example on a bedtime schedule.",
                        Fix.DND_SETTINGS, "Open settings", Collections.singletonList("Under what can interrupt, turn on \"Alarms\"."));
                }
                return pass("dnd", title, "Off.");
        }
    }

    static Check battery(Facts f) {
        String title = "Battery";
        if (f.batteryPercent < 0) {
            return new Check("battery", Status.UNVERIFIED, title, "SomniAI can't read the battery level. Plug in to be safe.",
                Fix.NONE, null, Collections.emptyList());
        }
        if (f.charging) {
            return pass("battery", title, "Charging, " + f.batteryPercent + " %.");
        }
        if (f.batteryPercent >= LOW_BATTERY_PERCENT) {
            return pass("battery", title, f.batteryPercent + " %, not charging.");
        }
        return new Check("battery", Status.FAIL, title,
            f.batteryPercent + " % and not charging: it could run out before the alarm. Plug in your phone.",
            Fix.NONE, null, Collections.emptyList());
    }

    static Brand brandOf(String manufacturer, String brand) {
        String m = (String.valueOf(manufacturer) + " " + String.valueOf(brand)).toLowerCase(Locale.ROOT);
        // Order matters: Realme and OnePlus phones can report Oppo as the manufacturer.
        if (m.contains("realme")) {
            return Brand.REALME;
        }
        if (m.contains("oneplus")) {
            return Brand.ONEPLUS;
        }
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) {
            return Brand.XIAOMI;
        }
        if (m.contains("oppo")) {
            return Brand.OPPO;
        }
        if (m.contains("vivo") || m.contains("iqoo")) {
            return Brand.VIVO;
        }
        if (m.contains("samsung")) {
            return Brand.SAMSUNG;
        }
        return Brand.OTHER;
    }

    static String name(Brand brand) {
        switch (brand) {
            case XIAOMI: return "Xiaomi";
            case REALME: return "Realme";
            case OPPO: return "Oppo";
            case VIVO: return "Vivo";
            case SAMSUNG: return "Samsung";
            case ONEPLUS: return "OnePlus";
            default: return "This phone";
        }
    }

    /**
     * The brand's own settings, from dontkillmyapp.com (read 2026-10-24 and
     * 2026-10-28). Menu names differ between versions; each step says where
     * to look, not a guaranteed path.
     */
    static List<String> managerSteps(Brand brand) {
        List<String> s = new ArrayList<>();
        switch (brand) {
            case XIAOMI:
                s.add("Settings > Apps > SomniAI > App permissions: turn on \"Background autostart\" (older versions: Security app > Permissions > Autostart).");
                s.add("Settings > Apps > SomniAI > Battery saver: choose \"No restrictions\".");
                s.add("In recent apps, lock SomniAI: drag its card down, or press and hold it and tap the padlock.");
                break;
            case REALME:
            case OPPO:
                s.add("Settings > Battery > App battery management > SomniAI: turn on \"Allow auto-launch\", \"Allow foreground activity\" and \"Allow background activity\".");
                s.add("Settings > Battery: turn off \"Sleep standby optimisation\" if it's there.");
                s.add("Settings > Apps > Special app access: allow SomniAI to \"Display over other apps\" (or \"Display pop-up windows\"), or the alarm screen may not open.");
                break;
            case VIVO:
                s.add("Settings > More settings > Applications > Autostart: turn SomniAI on (older versions: i Manager > App manager > Autostart manager).");
                s.add("Settings > Battery > Background power consumption management (or High background power consumption): allow SomniAI.");
                s.add("In recent apps, pull SomniAI's card down and tap the lock.");
                break;
            case SAMSUNG:
                s.add("Settings > Battery (or Device care > Battery) > Background usage limits: turn off \"Put unused apps to sleep\".");
                s.add("Remove SomniAI from \"Sleeping apps\" and \"Deep sleeping apps\", and add it to \"Never sleeping apps\".");
                s.add("Settings > Apps > SomniAI > Battery: choose \"Unrestricted\".");
                break;
            case ONEPLUS:
                s.add("Settings > Battery > Battery optimisation > (three dots) > Advanced optimisation: turn off \"Deep optimisation\" (or \"Adaptive battery\") and \"Sleep standby optimisation\".");
                s.add("Settings > Apps > SomniAI: turn on \"Auto-launch\" if your phone has it.");
                s.add("In recent apps, press and hold SomniAI's card and tap Lock.");
                break;
            default:
                break;
        }
        return s;
    }

    private static Check pass(String id, String title, String detail) {
        return new Check(id, Status.PASS, title, detail, Fix.NONE, null, Collections.emptyList());
    }

    private static Check fail(String id, String title, String detail, Fix fix, String fixLabel) {
        return new Check(id, Status.FAIL, title, detail, fix, fixLabel, Collections.emptyList());
    }
}
