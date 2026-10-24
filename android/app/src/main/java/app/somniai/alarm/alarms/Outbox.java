package app.somniai.alarm.alarms;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.CookieManager;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's queue of ring results for the server ({@link OutboxQueue} holds
 * the rules). Kept in device-protected storage, so a ring stopped before the
 * first unlock after a reboot is kept too. Sent by {@link SyncWorker}, which
 * WorkManager runs once there is a network, retrying with backoff while the
 * server can't be reached.
 *
 * Requests go to the server the web view loads (capacitor.config.json
 * server.url), signed in with the web view's own session cookie: the same
 * account, no second sign-in.
 */
final class Outbox {

    private static final String PREFS = "somni_outbox";
    private static final String KEY = "queue";
    static final String WORK = "somni-outbox-sync";
    /** For on-device tests: send here instead of the configured server. */
    static volatile String baseUrlOverride;
    /** For on-device tests that drive the queue themselves: don't start SyncWorker. */
    static volatile boolean autoSync = true;
    /** One per process, so its synchronized methods serialise every reader and writer. */
    private static OutboxQueue instance;

    private Outbox() {}

    static synchronized OutboxQueue queue(Context context) {
        if (instance != null) {
            return instance;
        }
        SharedPreferences prefs = context.getApplicationContext().createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        instance = new OutboxQueue(new OutboxQueue.Store() {
            @Override
            public String read() {
                return prefs.getString(KEY, null);
            }

            @Override
            public void write(String json) {
                // commit(): the result must be on disk before this process can be killed.
                prefs.edit().putString(KEY, json).commit();
            }
        });
        return instance;
    }

    static void enqueue(Context context, List<SyncCalls.Call> calls) {
        queue(context).enqueue(calls, System.currentTimeMillis());
        Log.i(AlarmScheduler.TAG, "queued " + calls.size() + " call(s) for the server; " + queue(context).size() + " waiting");
        scheduleSync(context);
    }

    /**
     * Asks WorkManager to send the queue once there is a network. Before the
     * first unlock WorkManager isn't available; the queue then waits for the
     * next app start or BOOT_COMPLETED, which call this again.
     */
    static void scheduleSync(Context context) {
        if (!autoSync) {
            return;
        }
        try {
            OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(SyncWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build();
            // KEEP: a sync already waiting sends everything, including what was just added.
            WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, work);
        }
        catch (IllegalStateException e) {
            Log.w(AlarmScheduler.TAG, "sync not scheduled yet (" + e.getMessage() + "); will retry at app start or after unlock");
        }
    }

    /** Sends the queue now, on this thread. Never call it on the main thread. */
    static OutboxQueue.Flush flushNow(Context context) {
        String base = baseUrl(context);
        OutboxQueue.Flush f = queue(context).flush((path, body) -> post(base, path, body));
        Log.i(AlarmScheduler.TAG, "sync: sent " + f.sent + ", dropped " + f.dropped + (f.stalled ? ", waiting (last status " + f.lastStatus + ")" : ", queue empty"));
        return f;
    }

    static String baseUrl(Context context) {
        if (baseUrlOverride != null) {
            return baseUrlOverride;
        }
        try (InputStream in = context.getAssets().open("capacitor.config.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            JSONObject server = new JSONObject(out.toString("UTF-8")).optJSONObject("server");
            return server == null ? null : server.optString("url", null);
        }
        catch (IOException | JSONException e) {
            Log.w(AlarmScheduler.TAG, "no server URL: " + e.getMessage());
            return null;
        }
    }

    /** The HTTP status, or -1 when the server couldn't be reached. */
    private static int post(String base, String path, String body) {
        if (base == null) {
            return -1;
        }
        HttpURLConnection c = null;
        try {
            String url = base.replaceAll("/+$", "") + path;
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            String cookie = sessionCookie(url);
            if (cookie != null) {
                c.setRequestProperty("Cookie", cookie);
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = c.getOutputStream()) {
                out.write(bytes);
            }
            return c.getResponseCode();
        }
        catch (IOException | RuntimeException e) {
            Log.w(AlarmScheduler.TAG, "sync: " + path + " not sent: " + e);
            return -1;
        }
        finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    private static String sessionCookie(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        }
        catch (RuntimeException e) {
            // No WebView available (it can't be loaded before the first unlock).
            return null;
        }
    }
}
