// The database goes down between setting an alarm and its ringing.
//
// The alarm must still ring, run its challenge and be dismissed from the
// record the page already holds; the server's routes are unusable meanwhile.
// What the ring changed waits in the outbox, nothing lost, and reaches the
// server through the real route handlers once the database is back. No AI
// Brain is configured in this file.
import mongoose from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import { GET as listAlarms, POST as createAlarm } from "@/app/api/alarms/route";
import { PATCH as patchAlarm } from "@/app/api/alarms/[id]/route";
import { POST as fire } from "@/app/api/alarms/[id]/fire/route";
import { POST as verify } from "@/app/api/alarms/[id]/verify/route";
import { POST as escalate } from "@/app/api/alarms/[id]/escalate/route";
import { POST as dismiss } from "@/app/api/alarms/[id]/dismiss/route";
import { POST as snooze } from "@/app/api/alarms/[id]/snooze/route";
import { Outbox, type KeyValueStore, type OutboxEntry } from "@/lib/outbox";
import { dismissLocally, snoozeLocally, syncCalls } from "@/lib/ringFlow";
import { resolveRingPlan } from "@/lib/ringPlan";
import type { Alarm as AlarmView } from "@/lib/types";
import { accumulateWakeEvidence, meetsThreshold } from "@/lib/wakeConfidence";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { idParams, makeUser, read, request, signInAs } from "./helpers";

type Handler = (req: ReturnType<typeof request>, ctx: ReturnType<typeof idParams>) => Promise<Response>;
const ACTIONS: Record<string, Handler> = { fire, verify, escalate, dismiss, snooze };

/** Sends an outbox entry to the real route handler for its path. */
async function toServer(entry: OutboxEntry) {
  const m = /^\/api\/alarms\/([^/]+)(?:\/(\w+))?$/.exec(entry.path);
  if (!m) {
    throw new Error(`no route for ${entry.path}`);
  }
  const handler = m[2] ? ACTIONS[m[2]] : patchAlarm;
  return handler(request(entry.method, entry.path, entry.body ?? {}), idParams(m[1]));
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

async function databaseDown() {
  // Queries now wait for a connection that isn't coming, then fail fast.
  mongoose.set("bufferTimeoutMS", 300);
  await mongoose.connection.close();
}

async function databaseBack() {
  await mongoose.connect(process.env.MONGO_DB_URI!);
}

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) {
    await databaseBack();
  }
});

async function setAlarm(body: Record<string, unknown> = {}): Promise<AlarmView> {
  const created = await read(await createAlarm(request("POST", "/api/alarms", {
    label: "Exam", scheduledTime: new Date(Date.now() + 60_000).toISOString(), ...body,
  })));
  expect(created.status).toBe(201);
  // What the page holds: the list as loaded before the night.
  const list = await read(await listAlarms(request("GET", "/api/alarms")));
  return list.body.data.items[0] as AlarmView;
}

describe("with no AI Brain configured", () => {
  it("the alarm records that the rule-based plan was used, and why", async () => {
    signInAs(await makeUser());
    const alarm = await setAlarm();
    expect(alarm.ringPlan).toMatchObject({ decidedBy: "fallback", note: "No AI Brain is configured, so the rule-based plan was used." });
  });
});

describe("with the database down at ring time", () => {
  it("the alarm rings, is solved and dismissed from its record, and syncs when the database is back", async () => {
    signInAs(await makeUser());
    const record = await setAlarm({ wakeStrategy: "aggressive", minConfidence: 70 });

    await databaseDown();
    // The server can't help now: its ring-time routes fail.
    expect((await fire(request("POST", "/x"), idParams(record._id))).status).toBe(503);

    // Ring time, from the record alone.
    const plan = resolveRingPlan(record);
    expect(plan).toEqual(record.ringPlan);
    expect(plan.sound).toEqual({ intensity: 60, strategy: "aggressive" });
    expect(plan.escalation.map((l) => l.afterSeconds)).toEqual([0, 5, 10, 18, 40]);
    expect(plan.challenge).toEqual({ required: true, methods: ["math"], minConfidence: 70 });
    // The maths challenge is solved quickly, scored on the device...
    const evidence = accumulateWakeEvidence([{ solved: true, responseMs: 6000, attempts: 0 }]);
    expect(meetsThreshold(evidence.score, plan.challenge.minConfidence)).toBe(true);
    // ...and the alarm is dismissed on the device.
    expect(dismissLocally(record, new Date())).toMatchObject({ status: "dismissed", enabled: false });

    // What happened waits in the outbox; sending now fails and loses nothing.
    const outbox = new Outbox(memoryStore(), "outbox");
    outbox.enqueue(syncCalls(record._id, {
      snoozed: false, responseMs: 6000, timeOnTaskMs: 5000, steps: 3, challenged: plan.challenge.required, methods: ["math"],
      attempts: 0, solved: true, correctness: 1, escalationLevel: 2, backups: [],
    }));
    const whileDown = await outbox.flush(toServer);
    expect(whileDown).toMatchObject({ sent: 0, stalled: true });
    expect(outbox.pending().map((e) => e.path.split("/").pop())).toEqual(["fire", "verify", "escalate", "dismiss"]);

    await databaseBack();
    const afterwards = await outbox.flush(toServer);
    expect(afterwards).toMatchObject({ sent: 4, stalled: false });
    expect(outbox.pending()).toEqual([]);
    expect(afterwards.alarms.get(record._id)).toMatchObject({ status: "verified", enabled: false });
    expect(await Alarm.findById(record._id).lean()).toMatchObject({ status: "verified" });
    const types = (await BehaviorEvent.find({ "meta.alarmId": record._id }).sort({ at: 1 }).lean<{ type: string }[]>())
      .map((e) => e.type);
    // The level the wake took (2) is recorded too: the personal ladder learns from it.
    expect(types).toEqual(["alarm_fire", "verify_pass", "escalation", "dismiss"]);
  });

  it("a snooze arms the alarm again on the device, and the server later agrees on the time", async () => {
    signInAs(await makeUser());
    const record = await setAlarm({ repeat: { type: "daily" } });

    await databaseDown();
    const snoozed = snoozeLocally(record, new Date());
    expect(snoozed.status).toBe("scheduled");

    const outbox = new Outbox(memoryStore(), "outbox");
    outbox.enqueue(syncCalls(record._id, {
      snoozed: true, snoozedUntil: snoozed.scheduledTime, responseMs: 3000, timeOnTaskMs: 0, steps: 0, challenged: true,
      methods: [], attempts: 0, solved: false, correctness: 0, escalationLevel: 1, backups: [],
    }));
    expect((await outbox.flush(toServer)).stalled).toBe(true);

    await databaseBack();
    const synced = await outbox.flush(toServer);
    expect(synced.alarms.get(record._id)).toMatchObject({ status: "scheduled", scheduledTime: snoozed.scheduledTime });
  });
});
