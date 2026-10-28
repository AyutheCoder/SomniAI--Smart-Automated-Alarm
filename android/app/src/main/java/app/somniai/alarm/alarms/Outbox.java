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
        // REPLACE, not KEEP: a sync that failed earlier waits out an exponential
        // back-off (up to hours), and a fresh "I'm awake" waited behind it, long
        // enough for a wake buddy to be told the opposite (found 2026-10-28).
        // Safe: flush is synchronized and removes each call only once sent, so
        // a replaced sync still running and the new one never send one twice.
        scheduleSync(context, ExistingWorkPolicy.REPLACE);
    }

    /** At app start and boot: keep a sync already waiting. */
    static void scheduleSync(Context context) {
        scheduleSync(context, ExistingWorkPolicy.KEEP);
    }

    /**
     * Asks WorkManager to send the queue once there is a network. Before the
     * first unlock WorkManager isn't available; the queue then waits for the
     * next app start or BOOT_COMPLETED, which call this again.
     */
    static void scheduleSync(Context context, ExistingWorkPolicy policy) {
        if (!autoSync) {
            return;
        }
        try {
            OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(SyncWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build();
            WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(WORK, policy, work);
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
        return request(base, path, body, 15_000).status;
    }

    /** A server answer: the status (-1: not reached) and the body, if any. */
    static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    /**
     * POSTs JSON to the server the web view loads, signed in with its session
     * cookie, and reads the answer. Never on the main thread.
     */
    static Response request(Context context, String path, String body, int timeoutMs) {
        return request(baseUrl(context), path, body, timeoutMs);
    }

    private static Response request(String base, String path, String body, int timeoutMs) {
        if (base == null) {
            return new Response(-1, null);
        }
        HttpURLConnection c = null;
        try {
            String url = base.replaceAll("/+$", "") + path;
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
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
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String answer = null;
            if (in != null) {
                try (InputStream stream = in) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[4096];
                    for (int n; (n = stream.read(chunk)) > 0; ) {
                        buf.write(chunk, 0, n);
                    }
                    answer = buf.toString("UTF-8");
                }
            }
            return new Response(status, answer);
        }
        catch (IOException | RuntimeException e) {
            Log.w(AlarmScheduler.TAG, "server: " + path + " not reached: " + e);
            return new Response(-1, null);
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
