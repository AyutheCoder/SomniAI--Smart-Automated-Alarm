// Server calls waiting to be sent, kept on the device.
//
// What happened at ring time is recorded here first and sent to the server
// only after the ring is over. If the server or its database is down, the
// calls stay queued, in order, survive a reload, and are retried until they
// are accepted. A call the server rejects as invalid (4xx) is dropped, since
// sending it again cannot succeed; a 5xx, a timeout, a network failure or a 401
// keeps it and everything after it for the next attempt.

export interface OutboxCall {
  alarmId: string;
  method: "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export interface OutboxEntry extends OutboxCall {
  id: string;
  queuedAt: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type Send = (entry: OutboxEntry) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface FlushResult {
  sent: number;
  dropped: number;
  /** True when something is still waiting: the server could not be reached. */
  stalled: boolean;
  /** The latest alarm record the server returned, per alarm, for calls that returned one. */
  alarms: Map<string, Record<string, unknown>>;
}

/**
 * Retrying can fix these; any other 4xx is a permanent rejection. 401 is here
 * because signing in again must not lose a morning's result (the native queue,
 * OutboxQueue.java, does the same; it used to be dropped here).
 */
const RETRYABLE_4XX = new Set([401, 408, 425, 429]);

export class Outbox {
  /** Kept in memory too, so the queue still works where storage is blocked. */
  private memory: OutboxEntry[] | null = null;

  constructor(private store: KeyValueStore | null, private key: string) {}

  pending(): OutboxEntry[] {
    if (this.store) {
      try {
        const raw = this.store.getItem(this.key);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed as OutboxEntry[];
          }
        }
        return this.memory ?? [];
      }
      catch {
        // Unreadable or blocked storage: fall back to memory.
      }
    }
    return this.memory ?? [];
  }

  private save(entries: OutboxEntry[]) {
    this.memory = entries;
    if (this.store) {
      try {
        this.store.setItem(this.key, JSON.stringify(entries));
      }
      catch {
        // Kept in memory for this page's lifetime.
      }
    }
  }

  pendingAlarmIds(): Set<string> {
    return new Set(this.pending().map((e) => e.alarmId));
  }

  enqueue(calls: OutboxCall[], now: Date = new Date()) {
    const stamp = now.toISOString();
    const added = calls.map((c, i) => ({ ...c, id: `${now.getTime()}-${i}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: stamp }));
    this.save([...this.pending(), ...added]);
  }

  /** Sends what is queued, in order, stopping at the first call that can't get through. */
  async flush(send: Send): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0, stalled: false, alarms: new Map() };
    let queue = this.pending();
    while (queue.length > 0) {
      const entry = queue[0];
      let status: number;
      let data: unknown;
      try {
        const res = await send(entry);
        status = res.status;
        data = status < 300 ? await res.json().catch(() => null) : null;
      }
      catch {
        result.stalled = true;
        break;
      }
      if (status >= 500 || RETRYABLE_4XX.has(status)) {
        result.stalled = true;
        break;
      }
      if (status >= 400) {
        result.dropped += 1;
      }
      else {
        result.sent += 1;
        const record = (data as { data?: Record<string, unknown> } | null)?.data;
        if (record && typeof record === "object" && "_id" in record) {
          result.alarms.set(entry.alarmId, record);
        }
      }
      queue = queue.slice(1);
      this.save(queue);
    }
    return result;
  }
}

/** localStorage when the browser allows it, else null (memory only). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  }
  catch {
    return null;
  }
}
