package app.somniai.alarm.alarms;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Ring results waiting to be sent to the server, kept on the phone, sent in
 * order when the network allows. The same rules as the web's lib/outbox.ts,
 * with one difference:
 * <ul>
 *   <li>2xx: sent, removed.</li>
 *   <li>5xx, 408, 425, 429, a timeout or no network: kept, with everything
 *       after it, for the next attempt.</li>
 *   <li>401: kept too. The phone may not be signed in yet, or the session
 *       expired; signing in again must not lose a morning's result. The web
 *       outbox (lib/outbox.ts) does the same since prompt 2.5.</li>
 *   <li>Any other 4xx: the server will never accept it (bad id, deleted
 *       alarm); dropped and reported, so the queue can't jam behind it.</li>
 * </ul>
 * Pure; storage and sending are passed in. Tested in OutboxQueueTest.
 */
final class OutboxQueue {

    interface Store {
        String read();
        void write(String json);
    }

    /** Returns the HTTP status, or a negative number when the server couldn't be reached. */
    interface Sender {
        int send(String path, String body);
    }

    static final class Flush {
        final int sent;
        final List<String> dropped;
        /** True when something is still waiting for a later attempt. */
        final boolean stalled;
        final int lastStatus;

        Flush(int sent, List<String> dropped, boolean stalled, int lastStatus) {
            this.sent = sent;
            this.dropped = dropped;
            this.stalled = stalled;
            this.lastStatus = lastStatus;
        }
    }

    /** Far more than a phone's alarms produce between connections; oldest go first beyond it. */
    static final int MAX = 500;

    private final Store store;

    OutboxQueue(Store store) {
        this.store = store;
    }

    synchronized void enqueue(List<SyncCalls.Call> calls, long now) {
        JSONArray all = pending();
        for (SyncCalls.Call c : calls) {
            JSONObject e = new JSONObject();
            try {
                e.put("id", UUID.randomUUID().toString());
                e.put("alarmId", c.alarmId);
                e.put("path", c.path);
                e.put("body", c.body.toString());
                e.put("queuedAt", now);
            }
            catch (JSONException ex) {
                throw new IllegalStateException(ex);
            }
            all.put(e);
        }
        while (all.length() > MAX) {
            all.remove(0);
        }
        store.write(all.toString());
    }

    synchronized JSONArray pending() {
        String raw = store.read();
        if (raw == null || raw.isEmpty()) {
            return new JSONArray();
        }
        try {
            return new JSONArray(raw);
        }
        catch (JSONException e) {
            // Unreadable: start over rather than block every later result behind it.
            return new JSONArray();
        }
    }

    synchronized int size() {
        return pending().length();
    }

    /**
     * Sends what is waiting, oldest first, stopping at the first call that
     * can't be sent now. The queue is saved after every call, so a crash
     * mid-flush neither loses one nor sends one twice that the server accepted.
     */
    synchronized Flush flush(Sender sender) {
        int sent = 0;
        List<String> dropped = new ArrayList<>();
        int status = 0;
        JSONArray all = pending();
        while (all.length() > 0) {
            JSONObject e = all.optJSONObject(0);
            status = sender.send(e.optString("path"), e.optString("body"));
            if (status >= 200 && status < 300) {
                sent++;
            }
            else if (isPermanent(status)) {
                dropped.add(e.optString("path") + " -> " + status);
            }
            else {
                return new Flush(sent, dropped, true, status);
            }
            all.remove(0);
            store.write(all.toString());
        }
        return new Flush(sent, dropped, false, status);
    }

    static boolean isPermanent(int status) {
        return status >= 400 && status < 500 && status != 401 && status != 408 && status != 425 && status != 429;
    }
}
