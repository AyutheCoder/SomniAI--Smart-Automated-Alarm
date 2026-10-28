package app.somniai.alarm.alarms;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.text.DateFormat;
import java.util.Date;
import java.util.List;

/**
 * "Tonight's alarm check": every {@link Preflight} check, pass or fail, each
 * with a one-tap fix where an app can offer one. Native, so it works with no
 * network and no web view. Re-checks whenever the user comes back from a
 * settings screen.
 */
public class PreflightActivity extends Activity {

    private static final int BG = Color.rgb(15, 23, 42);
    private static final int CARD = Color.rgb(30, 41, 59);
    private static final int GREEN = Color.rgb(52, 211, 153);
    private static final int RED = Color.rgb(251, 113, 133);
    private static final int AMBER = Color.rgb(251, 191, 36);
    private static final int MUTED = Color.rgb(148, 163, 184);

    /**
     * Known screens for each brand's autostart and battery manager. Not public
     * APIs: each is tried in turn and the app's own info page is the fallback.
     */
    private static final String[][] MANAGER_SCREENS = {
        { "XIAOMI", "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
        { "OPPO", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
        { "OPPO", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },
        { "OPPO", "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
        { "REALME", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
        { "REALME", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },
        { "VIVO", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
        { "VIVO", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity" },
        { "SAMSUNG", "com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity" },
        { "ONEPLUS", "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity" },
    };

    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        list.setPadding(pad, pad, pad, pad);
        scroll.addView(list);
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        List<Preflight.Check> checks = Preflight.run(PreflightProbe.read(this));
        int attention = Preflight.attention(checks);
        list.removeAllViews();

        list.addView(text("Tonight's alarm check", 26, Typeface.BOLD, Color.WHITE));
        Long next = PreflightReceiver.nextAlarmAt(this);
        list.addView(text(next == null ? "No alarm is set on this phone."
            : "Next alarm: " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(next)) + ".",
            15, Typeface.NORMAL, MUTED));
        TextView summary = text(attention == 0 ? "All clear: nothing here should stop your alarm."
            : attention + (attention == 1 ? " thing needs" : " things need") + " your attention.",
            18, Typeface.BOLD, attention == 0 ? GREEN : AMBER);
        summary.setPadding(0, dp(12), 0, dp(8));
        summary.setContentDescription("Summary");
        list.addView(summary);

        for (Preflight.Check c : checks) {
            list.addView(card(c));
        }
    }

    private View card(Preflight.Check c) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(14);
        card.setPadding(pad, pad, pad, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(CARD);
        bg.setCornerRadius(dp(12));
        card.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        card.setLayoutParams(lp);
        card.setContentDescription("check:" + c.id);

        TextView badge = text(badge(c.status), 13, Typeface.BOLD, color(c.status));
        badge.setContentDescription(c.id + ":" + c.status.name());
        card.addView(badge);
        card.addView(text(c.title, 18, Typeface.BOLD, Color.WHITE));
        card.addView(text(c.detail, 15, Typeface.NORMAL, Color.rgb(203, 213, 225)));
        for (int i = 0; i < c.steps.size(); i++) {
            TextView step = text((i + 1) + ". " + c.steps.get(i), 14, Typeface.NORMAL, MUTED);
            step.setPadding(0, dp(6), 0, 0);
            card.addView(step);
        }
        boolean showFix = c.fixLabel != null && (c.needsAttention() || c.status == Preflight.Status.CONFIRMED);
        if (showFix) {
            card.addView(button(c.fixLabel, "fix:" + c.id, v -> fix(c)));
        }
        if (c.id.equals("manufacturer")) {
            boolean confirmed = c.status == Preflight.Status.CONFIRMED;
            card.addView(button(confirmed ? "Not done after all" : "I've done these", "confirm:" + c.id, v -> {
                PreflightProbe.setManagerConfirmed(this, !confirmed);
                render();
            }));
        }
        return card;
    }

    private void fix(Preflight.Check c) {
        String pkg = getPackageName();
        switch (c.fix) {
            case EXACT_ALARM_SETTINGS:
                open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg)));
                break;
            case NOTIFICATION_SETTINGS:
                open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
                break;
            case FULL_SCREEN_SETTINGS:
                if (Build.VERSION.SDK_INT >= 34) {
                    open(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg)));
                }
                break;
            case BATTERY_OPTIMIZATION_SETTINGS:
                // The list, not the direct request: that needs a permission Google Play restricts.
                open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                break;
            case MANUFACTURER_SETTINGS:
                openManagerScreen();
                break;
            case RAISE_ALARM_VOLUME:
                raiseAlarmVolume();
                render();
                break;
            case DND_SETTINGS:
                open(new Intent(Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS));
                break;
            default:
                break;
        }
    }

    /** To 70 % of the alarm stream, the ladder's level-3 strength, with the volume panel shown. */
    private void raiseAlarmVolume() {
        AudioManager audio = getSystemService(AudioManager.class);
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
        int min = Build.VERSION.SDK_INT >= 28 ? audio.getStreamMinVolume(AudioManager.STREAM_ALARM) : 0;
        int to = RingTuning.streamIndex(audio.getStreamVolume(AudioManager.STREAM_ALARM), min, max, 1.4);
        try {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, to, AudioManager.FLAG_SHOW_UI);
        }
        catch (SecurityException e) {
            Log.w(AlarmScheduler.TAG, "alarm volume not raised: " + e.getMessage());
            open(new Intent(Settings.ACTION_SOUND_SETTINGS));
        }
    }

    private void openManagerScreen() {
        String brand = Preflight.brandOf(Build.MANUFACTURER, Build.BRAND).name();
        for (String[] s : MANAGER_SCREENS) {
            if (!s[0].equals(brand)) {
                continue;
            }
            try {
                startActivity(new Intent().setComponent(new ComponentName(s[1], s[2])));
                Log.i(AlarmScheduler.TAG, "bedtime check: opened " + s[1] + "/" + s[2]);
                return;
            }
            catch (ActivityNotFoundException | SecurityException e) {
                // Not on this version; try the next.
            }
        }
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    }

    /**
     * Opens a settings screen; if this phone lacks it, SomniAI's own app info.
     * In this task, so Back comes back to the check, which re-checks.
     */
    private void open(Intent intent) {
        try {
            startActivity(intent);
        }
        catch (ActivityNotFoundException | SecurityException e) {
            Log.w(AlarmScheduler.TAG, "bedtime check: " + intent.getAction() + " not available: " + e.getMessage());
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    private static String badge(Preflight.Status s) {
        switch (s) {
            case PASS: return "✓  OK";
            case FAIL: return "✗  FIX THIS";
            case UNVERIFIED: return "?  CHECK YOURSELF";
            default: return "✓  DONE, YOU SAID";
        }
    }

    private static int color(Preflight.Status s) {
        switch (s) {
            case PASS:
            case CONFIRMED:
                return GREEN;
            case FAIL:
                return RED;
            default:
                return AMBER;
        }
    }

    private Button button(String label, String description, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setContentDescription(description);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        return b;
    }

    private TextView text(String s, int sp, int style, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTypeface(Typeface.DEFAULT, style);
        t.setGravity(Gravity.START);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
