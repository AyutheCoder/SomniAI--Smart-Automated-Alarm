package app.somniai.alarm.alarms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import java.text.DateFormat;
import java.util.Date;

/**
 * The screen a ringing alarm shows, over the lock screen and turning the
 * screen on. Native and offline: it needs neither the web view nor the network.
 *
 * Stop dismisses at once. Prompt 2.4 puts the native wake check in front of it
 * for alarms whose ring plan requires one; until then this screen does not
 * enforce the plan's challenge.
 */
public class RingActivity extends Activity {

    private final BroadcastReceiver stopped = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(layout());
        ContextCompat.registerReceiver(this, stopped, new IntentFilter(RingService.ACTION_STOPPED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Opened from an old notification after the ring already ended.
        if (RingService.current == null) {
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(stopped);
        super.onDestroy();
    }

    private LinearLayout layout() {
        RingService.Snapshot now = RingService.current;
        String label = now == null || now.label.isEmpty() ? "Alarm" : now.label;
        String time = now == null ? "" : DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(now.scheduledFor));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(15, 23, 42));
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        TextView clock = text(time, 56, Typeface.BOLD);
        TextView name = text(label, 24, Typeface.NORMAL);
        name.setPadding(0, dp(8), 0, dp(48));

        Button stop = new Button(this);
        stop.setText("Stop alarm");
        stop.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        stop.setMinHeight(dp(72));
        stop.setContentDescription("Stop alarm");
        stop.setOnClickListener(v -> {
            RingService.dismiss(this);
            finish();
        });

        root.addView(clock);
        root.addView(name);
        root.addView(stop, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private TextView text(String s, int sp, int style) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTypeface(Typeface.DEFAULT, style);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
