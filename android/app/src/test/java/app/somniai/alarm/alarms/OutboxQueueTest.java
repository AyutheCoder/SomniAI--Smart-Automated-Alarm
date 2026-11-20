package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import org.junit.Test;

/** The offline queue: kept on the phone, sent in order, never lost to a bad connection. */
public class OutboxQueueTest {

    /** Storage that survives "restarts": a new OutboxQueue over the same Mem is a new process. */
    static final class Mem implements OutboxQueue.Store {
        String json;
        int writes;
        @Override public String read() { return json; }
        @Override public void write(String j) { json = j; writes++; }
    }

    /** Answers each send with the next scripted status and records what was sent. */
    static final class Server implements OutboxQueue.Sender {
        final Deque<Integer> statuses = new ArrayDeque<>();
        final List<String> received = new ArrayList<>();
        final List<String> keys = new ArrayList<>();
        Server answer(int... s) { for (int x : s) statuses.add(x); return this; }
        @Override public int send(String path, String body, String key) {
            keys.add(key);
            int s = statuses.isEmpty() ? 200 : statuses.poll();
            if (s >= 0) {
                received.add(path);
            }
            return s;
        }
    }

    static final int OFFLINE = -1;

    static List<SyncCalls.Call> ring(String id) {
        Verification v = new Verification(true, true, 1, 5_000, 0, List.of("math"), 90, 2_000);
        return SyncCalls.forRing(id, 1_000, "dismissed", 3_000, v, 2, List.of());
    }

    /**
     * The connection drops after the server did the work (prompt 7.3): the call
     * stays queued and is sent again under the same key, which the server
     * answers from the first time instead of recording it twice.
     */
    @Test
    public void aCallSentAgainAfterALostAnswerCarriesTheSameKey() {
        Mem mem = new Mem();
        new OutboxQueue(mem).enqueue(ring("a"), 0);
        Server first = new Server().answer(OFFLINE);
        assertTrue(new OutboxQueue(mem).flush(first).stalled);
        Server again = new Server();
        assertEquals(4, new OutboxQueue(mem).flush(again).sent);
        assertEquals(first.keys.get(0), again.keys.get(0));
        assertEquals(4, new java.util.HashSet<>(again.keys).size());
        for (String k : again.keys) {
            assertTrue(k, k.matches("[A-Za-z0-9_-]{8,100}"));
        }
    }

    @Test
    public void aDeletedAccountsCallsAreDroppedUnsentAndTheQueueStaysUsable() {
        Mem mem = new Mem();
        new OutboxQueue(mem).enqueue(ring("a"), 0);
        assertEquals(4, new OutboxQueue(mem).clear());
        Server server = new Server();
        OutboxQueue.Flush f = new OutboxQueue(mem).flush(server);
        assertEquals(0, f.sent);
        assertTrue(server.received.isEmpty());
        assertEquals(0, new OutboxQueue(mem).clear());
        new OutboxQueue(mem).enqueue(ring("b"), 1);
        assertEquals(4, new OutboxQueue(mem).size());
    }

    @Test
    public void offlineNothingIsSentAndNothingIsLost() {
        Mem mem = new Mem();
        new OutboxQueue(mem).enqueue(ring("a"), 0);
        OutboxQueue.Flush f = new OutboxQueue(mem).flush(new Server().answer(OFFLINE));
        assertTrue(f.stalled);
        assertEquals(0, f.sent);
        assertEquals(4, new OutboxQueue(mem).size());
    }

    @Test
    public void itSurvivesTheAppBeingKilledAndSendsInOrderOnceBackOnline() {
        Mem mem = new Mem();
        new OutboxQueue(mem).enqueue(ring("a"), 0);
        new OutboxQueue(mem).enqueue(ring("b"), 1);
        Server server = new Server();
        OutboxQueue.Flush f = new OutboxQueue(mem).flush(server);
        assertFalse(f.stalled);
        assertEquals(8, f.sent);
        assertEquals(List.of(
            "/api/alarms/a/fire", "/api/alarms/a/verify", "/api/alarms/a/escalate", "/api/alarms/a/dismiss",
            "/api/alarms/b/fire", "/api/alarms/b/verify", "/api/alarms/b/escalate", "/api/alarms/b/dismiss"), server.received);
        assertEquals(0, new OutboxQueue(mem).size());
    }

    @Test
    public void aServerErrorStopsTheFlushAndKeepsTheRestInOrder() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        q.enqueue(ring("a"), 0);
        Server first = new Server().answer(200, 503);
        OutboxQueue.Flush f = q.flush(first);
        assertTrue(f.stalled);
        assertEquals(1, f.sent);
        assertEquals(503, f.lastStatus);
        assertEquals("verify isn't skipped to send dismiss before it", 3, q.size());
        Server later = new Server();
        q.flush(later);
        assertEquals(List.of("/api/alarms/a/verify", "/api/alarms/a/escalate", "/api/alarms/a/dismiss"), later.received);
    }

    @Test
    public void notSignedInKeepsTheResultForLater() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        q.enqueue(ring("a"), 0);
        assertTrue(q.flush(new Server().answer(401)).stalled);
        assertEquals(4, q.size());
    }

    @Test
    public void retryableClientErrorsAreKept() {
        for (int status : new int[] { 408, 425, 429 }) {
            Mem mem = new Mem();
            OutboxQueue q = new OutboxQueue(mem);
            q.enqueue(ring("a"), 0);
            assertTrue(String.valueOf(status), q.flush(new Server().answer(status)).stalled);
            assertEquals(4, q.size());
        }
    }

    @Test
    public void aCallTheServerWillNeverAcceptIsDroppedSoItCantJamTheQueue() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        q.enqueue(ring("deleted"), 0);
        q.enqueue(ring("b"), 1);
        Server server = new Server().answer(404, 404, 404, 404);
        OutboxQueue.Flush f = q.flush(server);
        assertFalse(f.stalled);
        assertEquals(4, f.dropped.size());
        assertEquals(4, f.sent);
        assertEquals(0, q.size());
    }

    @Test
    public void theQueueIsSavedAfterEveryCall() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        q.enqueue(ring("a"), 0);
        int before = mem.writes;
        q.flush(new Server());
        assertEquals("one save per call sent", before + 4, mem.writes);
    }

    @Test
    public void unreadableStorageStartsOverRatherThanBlockingEveryLaterResult() {
        Mem mem = new Mem();
        mem.json = "{not json";
        OutboxQueue q = new OutboxQueue(mem);
        assertEquals(0, q.size());
        q.enqueue(ring("a"), 0);
        assertEquals(4, q.size());
    }

    @Test
    public void theQueueIsBoundedOldestFirst() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        for (int i = 0; i < OutboxQueue.MAX; i++) {
            q.enqueue(ring("r" + i), i);
        }
        assertEquals(OutboxQueue.MAX, q.size());
        assertTrue(q.pending().optJSONObject(OutboxQueue.MAX - 1).optString("path").contains("/r" + (OutboxQueue.MAX - 1) + "/"));
    }

    @Test
    public void telemetryCanBeRemovedUnsentLeavingTheRingsCalls() {
        Mem mem = new Mem();
        OutboxQueue q = new OutboxQueue(mem);
        q.enqueue(ring("a"), 0);
        q.enqueue(List.of(new SyncCalls.Call("a", "/api/telemetry", new org.json.JSONObject())), 1);
        q.enqueue(ring("b"), 2);
        q.enqueue(List.of(new SyncCalls.Call("b", "/api/telemetry", new org.json.JSONObject())), 3);
        int before = q.size();
        assertEquals(2, q.removeWhere("/api/telemetry"));
        assertEquals(before - 2, q.size());
        for (int i = 0; i < q.pending().length(); i++) {
            assertFalse(q.pending().optJSONObject(i).optString("path").equals("/api/telemetry"));
        }
        assertEquals(0, q.removeWhere("/api/telemetry"));
    }
}
