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
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.security.SecureRandom;
import java.text.DateFormat;
import java.util.Date;

/**
 * The screen a ringing alarm shows, over the lock screen and turning the
 * screen on. Native and offline: it needs neither the web view nor the network.
 *
 * If the ring plan asks for a wake check, Stop leads to maths problems
 * ({@link WakeCheck}); the alarm stops only when the check passes, and the
 * service checks that again before it stops. A wrong answer brings a new
 * problem and never stops the alarm.
 */
public class RingActivity extends Activity {

    private final BroadcastReceiver stopped = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    private WakeCheck check;
    private TextView progress;
    private TextView question;
    private EditText answer;
    private TextView message;

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
        setContentView(ringView());
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

    private void stopPressed() {
        RingService.Snapshot now = RingService.current;
        WakeCheck.Plan plan = now == null ? WakeCheck.Plan.DEFAULT : now.check;
        if (!plan.required) {
            RingService.dismiss(this, Verification.none(System.currentTimeMillis()));
            return;
        }
        check = new WakeCheck(plan, new SecureRandom(), System.currentTimeMillis());
        setContentView(checkView());
        showProblem("");
        // Open the keyboard at once: nobody should have to find the field half asleep.
        answer.post(() -> getSystemService(InputMethodManager.class).showSoftInput(answer, InputMethodManager.SHOW_IMPLICIT));
    }

    private void submit() {
        long now = System.currentTimeMillis();
        WakeCheck.Step step = check.submit(answer.getText().toString(), now);
        switch (step) {
            case WRONG:
                showProblem("Not quite. Here's a new one.");
                break;
            case NEXT:
                showProblem("Right. Next one.");
                break;
            case RETRY:
                showProblem("All right, but slow: " + check.lastScore() + "% awake, " + check.plan().minConfidence
                    + "% needed. Once more.");
                break;
            case PASSED:
                answer.setEnabled(false);
                message.setText("Awake. Stopping the alarm.");
                // The screen closes when the service confirms it stopped (ACTION_STOPPED).
                RingService.dismiss(this, check.verification(now));
                break;
        }
    }

    private void showProblem(String note) {
        WakeCheck.Plan plan = check.plan();
        progress.setText(plan.count > 1 ? "Problem " + check.position() + " of " + plan.count : "");
        question.setText(check.question() + " = ?");
        answer.setText("");
        answer.requestFocus();
        message.setText(note);
    }

    private LinearLayout ringView() {
        RingService.Snapshot now = RingService.current;
        String label = now == null || now.label.isEmpty() ? "Alarm" : now.label;
        String time = now == null ? "" : DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(now.scheduledFor));

        LinearLayout root = column();
        TextView name = text(label, 24, Typeface.NORMAL);
        name.setPadding(0, dp(8), 0, dp(48));
        root.addView(text(time, 56, Typeface.BOLD));
        root.addView(name);
        root.addView(button("Stop alarm", v -> stopPressed()), fill());
        clearOfKeyboardAndBars(root);
        return root;
    }

    /**
     * Scrolls, and keeps clear of the keyboard: with the app drawn edge to edge
     * (enforced from Android 15) the window no longer shrinks for the keyboard,
     * which on a phone covered the Check button.
     */
    private View checkView() {
        LinearLayout root = column();
        root.addView(text("Solve to stop the alarm", 22, Typeface.BOLD));
        progress = text("", 16, Typeface.NORMAL);
        question = text("", 48, Typeface.BOLD);
        question.setPadding(0, dp(24), 0, dp(16));
        question.setContentDescription("Problem");
        answer = new EditText(this);
        answer.setInputType(InputType.TYPE_CLASS_NUMBER);
        answer.setImeOptions(EditorInfo.IME_ACTION_DONE);
        answer.setTextColor(Color.WHITE);
        answer.setHintTextColor(Color.GRAY);
        answer.setHint("Answer");
        answer.setGravity(Gravity.CENTER);
        answer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        answer.setContentDescription("Answer");
        answer.setOnEditorActionListener((v, actionId, event) -> {
            submit();
            return true;
        });
        message = text("", 16, Typeface.NORMAL);
        message.setPadding(0, dp(12), 0, dp(12));
        root.addView(progress);
        root.addView(question);
        root.addView(answer, fill());
        root.addView(message);
        root.addView(button("Check", v -> submit()), fill());
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(15, 23, 42));
        scroll.addView(root);
        clearOfKeyboardAndBars(scroll);
        return scroll;
    }

    private static void clearOfKeyboardAndBars(View v) {
        ViewCompat.setOnApplyWindowInsetsListener(v, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private LinearLayout column() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(15, 23, 42));
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);
        return root;
    }

    private Button button(String label, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        b.setMinHeight(dp(72));
        b.setContentDescription(label);
        b.setOnClickListener(onClick);
        return b;
    }

    private static LinearLayout.LayoutParams fill() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
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
