package app.somniai.alarm.alarms;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * What SomniAI reads from Health Connect and why (prompt 4.2). Health Connect
 * links here from its permission screen, and won't show that screen for an
 * app without it.
 */
public class HealthRationaleActivity extends Activity {

    static final String TEXT =
        "SomniAI reads two things from Health Connect, and never writes to it:\n\n"
        + "• Sleep sessions: when you fell asleep and woke up, and how long you slept. "
        + "When a night has several sessions, the longest is kept.\n"
        + "• Resting heart rate, for the same day.\n\n"
        + "They become your sleep log, which the wake predictions and the bedtime plan learn from, "
        + "so they are about your nights rather than an average person's. "
        + "Only the last two weeks are read, and only while SomniAI is open.\n\n"
        + "They go to your SomniAI account and nowhere else. You can stop this at any time in "
        + "Health Connect's app permissions; nights already in your sleep log stay until you delete them.";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(15, 23, 42));
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics()));
        box.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText("SomniAI and your sleep data");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        TextView body = new TextView(this);
        body.setText(TEXT);
        body.setTextColor(Color.rgb(203, 213, 225));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setPadding(0, pad, 0, 0);
        box.addView(title);
        box.addView(body);
        scroll.addView(box);
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(scroll);
    }
}
