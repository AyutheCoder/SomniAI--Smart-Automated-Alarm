// The web half of keeping the phone's schedule in step with the server. The
// fake plugin keeps a schedule the way ReconcilePlan.java does, so create,
// edit, toggle, delete and repeated calls can be checked end to end.
import { describe, expect, it } from "vitest";
import { NativeSync, REQUIRED_NATIVE_API, connectNative, type NativeSyncStatus } from "./nativeSync";
import type { NativeAlarm } from "./nativeAlarm";
import type { Alarm } from "./types";

const A = "64f0a1b2c3d4e5f601234567";
const B = "64f0a1b2c3d4e5f60123456b";

function alarm(id: string, over: Partial<Alarm> = {}): Alarm {
  return {
    _id: id,
    userId: "u",
    label: "Wake",
    scheduledTime: new Date(2030, 0, 15, 7, 0).toISOString(),
    source: "manual",
    repeat: { type: "daily" },
    intensity: 60,
    wakeStrategy: "adaptive",
    verificationRequired: true,
    verificationMethod: "math",
    minConfidence: 70,
    status: "scheduled",
    enabled: true,
    lastSnoozeCount: 0,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/** A phone: reconcile replaces its schedule with the list, reporting what changed. */
class FakePhone {
  schedule = new Map<string, NativeAlarm>();
  calls: NativeAlarm[][] = [];
  failNext: string | null = null;
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  hold() {
    this.gate = new Promise((r) => {
      this.open = r;
    });
  }

  release() {
    this.open?.();
    this.gate = null;
  }

  async reconcile({ alarms }: { alarms: NativeAlarm[] }) {
    this.calls.push(alarms);
    if (this.gate) {
      await this.gate;
    }
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw new Error(e);
    }
    const put: string[] = [];
    const unchanged: string[] = [];
    const removed = [...this.schedule.keys()].filter((id) => !alarms.some((a) => a.id === id));
    for (const id of removed) {
      this.schedule.delete(id);
    }
    for (const a of alarms) {
      if (JSON.stringify(this.schedule.get(a.id)) === JSON.stringify(a)) {
        unchanged.push(a.id);
      }
      else {
        this.schedule.set(a.id, a);
        put.push(a.id);
      }
    }
    return { put, removed, unchanged, keptHistory: [], past: [], exactAlarm: { state: "granted" as const, permission: null, sdk: 36 } };
  }
}

function setup() {
  const phone = new FakePhone();
  const statuses: NativeSyncStatus[] = [];
  const sync = new NativeSync(phone, (s) => statuses.push(s));
  return { phone, sync, statuses };
}

describe("NativeSync", () => {
  it("creating an alarm puts it on the phone", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A)]);
    expect(phone.schedule.get(A)).toMatchObject({ id: A, hour: 7, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], enabled: true });
  });

  it("editing an alarm's time changes it on the phone", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A)]);
    await sync.sync([alarm(A, { scheduledTime: new Date(2030, 0, 15, 6, 15).toISOString() })]);
    expect(phone.schedule.get(A)).toMatchObject({ hour: 6, minute: 15 });
  });

  it("turning an alarm off and on again follows to the phone", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A)]);
    await sync.sync([alarm(A, { enabled: false })]);
    expect(phone.schedule.get(A)?.enabled).toBe(false);
    await sync.sync([alarm(A, { enabled: true })]);
    expect(phone.schedule.get(A)?.enabled).toBe(true);
  });

  it("deleting an alarm removes it from the phone, even the last one", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A), alarm(B)]);
    await sync.sync([alarm(B)]);
    expect([...phone.schedule.keys()]).toEqual([B]);
    await sync.sync([]);
    expect(phone.schedule.size).toBe(0);
  });

  it("the same list again doesn't call the phone again", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A)]);
    await sync.sync([alarm(A)]);
    await sync.sync([{ ...alarm(A), status: "ringing" }]); // status isn't part of the schedule
    expect(phone.calls).toHaveLength(1);
  });

  it("rapid changes are folded into one follow-up with the latest list", async () => {
    const { phone, sync } = setup();
    phone.hold();
    const first = sync.sync([alarm(A)]);
    void sync.sync([alarm(A), alarm(B)]);
    void sync.sync([alarm(A, { enabled: false }), alarm(B)]);
    const last = sync.sync([alarm(B)]);
    phone.release();
    await Promise.all([first, last]);
    expect(phone.calls).toHaveLength(2);
    expect(phone.calls[1].map((a) => a.id)).toEqual([B]);
    expect([...phone.schedule.keys()]).toEqual([B]);
  });

  it("a failure is reported and the same list is tried again next time", async () => {
    const { phone, sync, statuses } = setup();
    phone.failNext = "plugin unavailable";
    await sync.sync([alarm(A)]);
    expect(statuses.at(-1)).toMatchObject({ state: "failed", error: "plugin unavailable" });
    expect(phone.schedule.size).toBe(0);
    await sync.sync([alarm(A)]);
    expect(phone.calls).toHaveLength(2);
    expect(statuses.at(-1)).toMatchObject({ state: "synced", result: { put: [A] } });
  });

  it("an alarm without a valid time is reported and the rest still sync", async () => {
    const { phone, sync, statuses } = setup();
    await sync.sync([alarm(A, { scheduledTime: "never" }), alarm(B)]);
    expect([...phone.schedule.keys()]).toEqual([B]);
    expect(statuses.at(-1)).toMatchObject({ state: "synced", skipped: [expect.stringContaining(A)] });
  });

  it("a repeating alarm snoozed in a browser keeps its own time on the phone", async () => {
    const { phone, sync } = setup();
    await sync.sync([alarm(A, {
      status: "snoozed",
      scheduledTime: new Date(2030, 0, 15, 7, 5).toISOString(),
      snoozedFrom: new Date(2030, 0, 15, 7, 0).toISOString(),
    })]);
    expect(phone.schedule.get(A)).toMatchObject({ hour: 7, minute: 0 });
  });
});

describe("connectNative", () => {
  const plugin = (version: () => Promise<{ api: number }>) => ({ version, reconcile: async () => { throw new Error("unused"); } });

  it("in a browser there is no native schedule", async () => {
    expect(await connectNative(undefined, plugin(async () => ({ api: 2 })), () => false)).toEqual({ reason: "browser" });
  });

  it("an app built before 2.5 has no version and is left alone", async () => {
    const r = await connectNative(undefined, plugin(async () => { throw new Error("not implemented"); }), () => true);
    expect(r).toMatchObject({ reason: expect.stringContaining("Update it") });
  });

  it("an older plugin version is refused, the current one accepted", async () => {
    expect(await connectNative(undefined, plugin(async () => ({ api: REQUIRED_NATIVE_API - 1 })), () => true)).toMatchObject({ reason: expect.any(String) });
    expect(await connectNative(undefined, plugin(async () => ({ api: REQUIRED_NATIVE_API })), () => true)).toHaveProperty("sync");
    expect(await connectNative(undefined, plugin(async () => ({ api: 3 })), () => true)).toMatchObject({ api: 3 });
  });
});
