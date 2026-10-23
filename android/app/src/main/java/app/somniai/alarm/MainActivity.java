package app.somniai.alarm;

import android.os.Bundle;
import app.somniai.alarm.alarms.SomniAlarmPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // In-app plugins are registered before the bridge starts.
        registerPlugin(SomniAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
