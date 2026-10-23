import { describe, expect, it } from "vitest";
import { mergeWithLocal } from "./alarmCache";
import { Outbox, type KeyValueStore, type OutboxEntry } from "./outbox";
import { dismissLocally, snoozeLocally, syncCalls, type RingOutcome } from "./ringFlow";
import type { Alarm } from "./types";

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    _id: "a1", userId: "u1", label: "Exam", scheduledTime: "2026-10-24T07:00:00.000Z", source: "manual",
    repeat: { type: "none" }, intensity: 60, wakeStrategy: "adaptive", verificationRequired: true,
    verificationMethod: "math", minConfidence: 70, status: "scheduled", enabled: true, lastSnoozeCount: 0,
    createdAt: "", updatedAt: "", ...over,
  };
}

const NOW = new Date("2026-10-24T07:01:00.000Z");

describe("ring outcomes take effect on the device, with no server", () => {
  it("a snooze arms the alarm again five minutes on and remembers when it was due", () => {
    const s = snoozeLocally(alarm(), NOW);
    expect(s).toMatchObject({ status: "scheduled", lastSnoozeCount: 1, snoozedFrom: "2026-10-24T07:00:00.000Z" });
    expect(s.scheduledTime).toBe("2026-10-24T07:06:00.000Z");
    expect(snoozeLocally(s, new Date("2026-10-24T07:07:00.000Z")).snoozedFrom).toBe("2026-10-24T07:00:00.000Z");
  });

  it("dismissing a one-off ends it", () => {
    expect(dismissLocally(alarm(), NOW)).toMatchObject({ status: "dismissed", enabled: false });
  });

  it("dismissing a daily alarm arms tomorrow at its own time, even after snoozes", () => {
    const due = new Date(2026, 9, 24, 7, 0, 0);
    const snoozed = snoozeLocally(snoozeLocally(alarm({ repeat: { type: "daily" }, scheduledTime: due.toISOString() }), NOW), NOW);
    const next = dismissLocally(snoozed, new Date(2026, 9, 24, 7, 12));
    const at = new Date(next.scheduledTime);
    expect(next).toMatchObject({ status: "scheduled", enabled: true, lastSnoozeCount: 0 });
    expect(next.snoozedFrom).toBeUndefined();
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([25, 7, 0]);
  });
});

const OUTCOME: RingOutcome = {
  snoozed: false, responseMs: 9000, challenged: true, methods: ["math"], attempts: 1,
  solved: true, correctness: 1, escalationLevel: 5, backups: [{ kind: "smartwatch", status: "not_configured" }],
};

describe("what the server is told afterwards", () => {
  it("a dismissal: fire, verify, escalate, dismiss, in that order", () => {
    expect(syncCalls("a1", OUTCOME).map((c) => c.path)).toEqual([
      "/api/alarms/a1/fire", "/api/alarms/a1/verify", "/api/alarms/a1/escalate", "/api/alarms/a1/dismiss",
    ]);
  });

  it("no verify for an alarm without a challenge, no escalate below the backup level", () => {
    const calls = syncCalls("a1", { ...OUTCOME, challenged: false, escalationLevel: 3 });
    expect(calls.map((c) => c.path)).toEqual(["/api/alarms/a1/fire", "/api/alarms/a1/dismiss"]);
  });

  it("a snooze sends the time the device set, not one the server would work out later", () => {
    const calls = syncCalls("a1", { ...OUTCOME, snoozed: true, snoozedUntil: "2026-10-24T07:06:00.000Z" });
    expect(calls.map((c) => c.path)).toEqual(["/api/alarms/a1/fire", "/api/alarms/a1/snooze"]);
    expect(calls[1].body).toMatchObject({ until: "2026-10-24T07:06:00.000Z", snoozeMinutes: 5 });
  });
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const reply = (status: number, data?: unknown) => async () => ({ status, json: async () => ({ ok: status < 300, data }) });

describe("the outbox, with the server or database down", () => {
  it("keeps every call, in order, while the database is down, and delivers them when it is back", async () => {
    const store = memoryStore();
    const box = new Outbox(store, "k");
    box.enqueue(syncCalls("a1", OUTCOME));
    const down = await box.flush(reply(503));
    expect(down).toMatchObject({ sent: 0, stalled: true });
    expect(box.pending().map((e) => e.path.split("/").pop())).toEqual(["fire", "verify", "escalate", "dismiss"]);

    const sent: string[] = [];
    const up = await box.flush(async (e: OutboxEntry) => {
      sent.push(e.path.split("/").pop()!);
      return { status: 200, json: async () => ({ ok: true, data: e.path.endsWith("dismiss") ? { _id: "a1", status: "verified" } : {} }) };
    });
    expect(sent).toEqual(["fire", "verify", "escalate", "dismiss"]);
    expect(up).toMatchObject({ sent: 4, stalled: false });
    expect(up.alarms.get("a1")).toEqual({ _id: "a1", status: "verified" });
    expect(box.pending()).toEqual([]);
  });

  it("treats a network failure like an outage: nothing lost", async () => {
    const box = new Outbox(memoryStore(), "k");
    box.enqueue(syncCalls("a1", OUTCOME));
    const result = await box.flush(async () => { throw new TypeError("Failed to fetch"); });
    expect(result.stalled).toBe(true);
    expect(box.pending()).toHaveLength(4);
  });

  it("stops at the first failure so later calls never overtake earlier ones", async () => {
    const box = new Outbox(memoryStore(), "k");
    box.enqueue(syncCalls("a1", OUTCOME));
    let n = 0;
    await box.flush(async () => ({ status: ++n === 2 ? 503 : 200, json: async () => ({ ok: true }) }));
    expect(box.pending().map((e) => e.path.split("/").pop())).toEqual(["verify", "escalate", "dismiss"]);
  });

  it("drops a call the server rejects as invalid, since retrying can't help, and carries on", async () => {
    const box = new Outbox(memoryStore(), "k");
    box.enqueue(syncCalls("gone", { ...OUTCOME, challenged: false, escalationLevel: 1 }));
    const result = await box.flush(reply(404));
    expect(result).toMatchObject({ dropped: 2, stalled: false });
    expect(box.pending()).toEqual([]);
  });

  it("survives a reload: a new outbox on the same storage sees the queued calls", () => {
    const store = memoryStore();
    new Outbox(store, "k").enqueue(syncCalls("a1", OUTCOME));
    expect(new Outbox(store, "k").pendingAlarmIds()).toEqual(new Set(["a1"]));
  });

  it("still queues in memory when the browser blocks storage", async () => {
    const blocked: KeyValueStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const box = new Outbox(blocked, "k");
    box.enqueue(syncCalls("a1", OUTCOME));
    expect(box.pending()).toHaveLength(4);
    expect((await box.flush(reply(200))).sent).toBe(4);
  });
});

describe("the device's alarm list after a reload", () => {
  it("keeps the device's copy of an alarm whose changes have not reached the server", () => {
    const server = [alarm({ _id: "a1", status: "scheduled" }), alarm({ _id: "a2", label: "Server copy" })];
    const local = [alarm({ _id: "a1", status: "dismissed", enabled: false }), alarm({ _id: "a2", label: "Old local" })];
    const merged = mergeWithLocal(server, local, new Set(["a1"]));
    expect(merged.map((a) => [a._id, a.status, a.label])).toEqual([["a1", "dismissed", "Exam"], ["a2", "scheduled", "Server copy"]]);
  });
});
