package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The real queue on a device: stored where the ring service writes it, sent
 * over HTTP by the code SyncWorker runs, against a small server on the
 * phone itself that can be down, failing, or up.
 */
@RunWith(AndroidJUnit4.class)
public class OutboxSyncTest {

    private Context context;
    private Stub server;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // This test sends the queue itself; a SyncWorker running alongside would race it.
        Outbox.autoSync = false;
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork(Outbox.WORK).getResult().get();
        // Start from an empty queue; earlier tests' rings are queued for a server that doesn't exist.
        Outbox.queue(context).flush((path, body) -> 404);
    }

    @After
    public void tearDown() throws Exception {
        Outbox.baseUrlOverride = null;
        Outbox.autoSync = true;
        if (server != null) {
            server.close();
        }
    }

    @Test
    public void withTheServerUnreachableNothingIsLostAndItAllArrivesInOrderLater() throws Exception {
        Verification passed = new Verification(true, true, 1, 7_000, 1, List.of("math"), 88, 1_792_996_840_000L);
        Outbox.enqueue(context, SyncCalls.forRing("64f0a1b2c3d4e5f601234567", 1_792_996_800_000L, "dismissed", 1_792_996_842_000L, passed, 4, java.util.List.of()));

        // Nothing listening: as with no network, the send fails and everything waits.
        Outbox.baseUrlOverride = "http://127.0.0.1:9";
        OutboxQueue.Flush offline = Outbox.flushNow(context);
        assertTrue(offline.stalled);
        assertEquals(0, offline.sent);
        assertEquals("fire, verify, escalate, dismiss", 4, Outbox.queue(context).size());

        // The server comes back but is failing: still kept.
        server = new Stub(503);
        Outbox.baseUrlOverride = server.url();
        assertTrue(Outbox.flushNow(context).stalled);
        assertEquals(4, Outbox.queue(context).size());

        // Healthy: sent in order with the times they happened.
        server.answers.add(200);
        server.answers.add(200);
        server.answers.add(200);
        server.answers.add(200);
        OutboxQueue.Flush back = Outbox.flushNow(context);
        assertFalse(back.stalled);
        assertEquals(4, back.sent);
        assertEquals(0, Outbox.queue(context).size());

        List<String> got = server.received();
        assertEquals("the 503 one, then the four", 5, got.size());
        assertTrue(got.get(1).startsWith("POST /api/alarms/64f0a1b2c3d4e5f601234567/fire "));
        assertTrue(got.get(2).startsWith("POST /api/alarms/64f0a1b2c3d4e5f601234567/verify "));
        assertTrue(got.get(3).startsWith("POST /api/alarms/64f0a1b2c3d4e5f601234567/escalate "));
        assertTrue(got.get(4).startsWith("POST /api/alarms/64f0a1b2c3d4e5f601234567/dismiss "));
        assertEquals(4, new JSONObject(got.get(3).substring(got.get(3).indexOf('{'))).getInt("level"));
        JSONObject verify = new JSONObject(got.get(2).substring(got.get(2).indexOf('{')));
        assertTrue(verify.getBoolean("solved"));
        assertEquals("2026-10-26T06:40:40Z", verify.getString("at"));
    }

    @Test
    public void notSignedInKeepsItForLater() throws Exception {
        Outbox.enqueue(context, SyncCalls.forRing("64f0a1b2c3d4e5f601234567", 1_000, "unanswered", 2_000, null, 1, java.util.List.of()));
        server = new Stub(401);
        Outbox.baseUrlOverride = server.url();
        assertTrue(Outbox.flushNow(context).stalled);
        assertEquals(1, Outbox.queue(context).size());
    }

    /** A one-request-per-connection HTTP server on the phone. */
    static final class Stub implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0);
        final Deque<Integer> answers = new ArrayDeque<>();
        private final List<String> received = Collections.synchronizedList(new ArrayList<>());
        private final Thread thread;

        Stub(int first) throws Exception {
            answers.add(first);
            thread = new Thread(this::serve, "stub-server");
            thread.start();
        }

        String url() {
            return "http://127.0.0.1:" + socket.getLocalPort();
        }

        List<String> received() {
            return new ArrayList<>(received);
        }

        private void serve() {
            while (!socket.isClosed()) {
                try (Socket s = socket.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                    String requestLine = in.readLine();
                    int length = 0;
                    String line;
                    while ((line = in.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase().startsWith("content-length:")) {
                            length = Integer.parseInt(line.substring(15).trim());
                        }
                    }
                    char[] body = new char[length];
                    int read = 0;
                    while (read < length) {
                        int n = in.read(body, read, length - read);
                        if (n < 0) {
                            break;
                        }
                        read += n;
                    }
                    received.add(requestLine + " " + new String(body, 0, read));
                    int status = answers.isEmpty() ? 200 : answers.poll();
                    OutputStream out = s.getOutputStream();
                    out.write(("HTTP/1.1 " + status + " X\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                catch (Exception e) {
                    // Closed, or a bad request; keep serving until closed.
                }
            }
        }

        @Override
        public void close() throws Exception {
            socket.close();
            thread.join(2_000);
        }
    }
}
