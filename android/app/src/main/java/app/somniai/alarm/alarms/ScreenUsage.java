package app.somniai.alarm.alarms;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Android's usage records, for screen time before bed (prompt 4.3). Reading
 * them needs "Usage access", a special permission the user turns on in
 * Settings; without it nothing is read. Only the minutes per night leave the
 * phone (ScreenNights), never which apps were used.
 */
final class ScreenUsage {

    private ScreenUsage() {
    }

    /** Whether the user has turned on Usage access for SomniAI. */
    static boolean allowed(Context context) {
        AppOpsManager ops = context.getSystemService(AppOpsManager.class);
        if (ops == null) {
            return false;
        }
        int mode = Build.VERSION.SDK_INT >= 29
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName());
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return context.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /** Settings' Usage access page: SomniAI's own where the phone has one, else the list. */
    static List<Intent> settingsIntents(Context context) {
        List<Intent> out = new ArrayList<>();
        out.add(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + context.getPackageName())));
        out.add(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        return out;
    }

    /** The home screens and the system UI: not screen time, as Digital Wellbeing doesn't count them. */
    static Set<String> excluded(Context context) {
        Set<String> out = new HashSet<>();
        out.add("com.android.systemui");
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo r : context.getPackageManager().queryIntentActivities(home, 0)) {
            if (r.activityInfo != null) {
                out.add(r.activityInfo.packageName);
            }
        }
        return out;
    }

    /** The last {@link ScreenNights#DAYS} nights. Call only when {@link #allowed}. */
    static ScreenNights.Result read(Context context, Map<String, Instant> bedtimes, Instant now, ZoneId zone) {
        LocalDate first = now.atZone(zone).toLocalDate().minusDays(ScreenNights.DAYS);
        Instant from = first.atTime(6, 0).atZone(zone).toInstant();
        UsageStatsManager usage = context.getSystemService(UsageStatsManager.class);
        List<ScreenNights.Event> events = new ArrayList<>();
        UsageEvents found = usage == null ? null : usage.queryEvents(from.toEpochMilli(), now.toEpochMilli());
        if (found != null) {
            UsageEvents.Event e = new UsageEvents.Event();
            while (found.hasNextEvent()) {
                found.getNextEvent(e);
                events.add(new ScreenNights.Event(Instant.ofEpochMilli(e.getTimeStamp()), e.getEventType(), e.getPackageName(), e.getClassName()));
            }
        }
        // Android keeps these records for a limited time: the first one says
        // from when they cover, of any kind (the system writes some every few hours).
        Instant recordsFrom = null;
        for (ScreenNights.Event e : events) {
            if (recordsFrom == null || e.at.isBefore(recordsFrom)) {
                recordsFrom = e.at;
            }
        }
        return ScreenNights.measure(events, excluded(context), bedtimes, recordsFrom, zone, now);
    }
}
