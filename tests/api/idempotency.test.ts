// Network lost mid-request (prompt 7.3), on the server: the outbox's call
// reached the server and was done, the answer was lost, and the outbox sends
// it again. With its Idempotency-Key the second send is answered from the
// first, so the ring is recorded once.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as createAlarm } from "@/app/api/alarms/route";
import { POST as fire } from "@/app/api/alarms/[id]/fire/route";
import { POST as dismiss } from "@/app/api/alarms/[id]/dismiss/route";
import { POST as verify } from "@/app/api/alarms/[id]/verify/route";
import { POST as escalate } from "@/app/api/alarms/[id]/escalate/route";
import { REPLAYED_HEADER, withIdempotency } from "@/lib/idempotency";
import { Outbox, type KeyValueStore, type OutboxEntry } from "@/lib/outbox";
import { syncCalls } from "@/lib/ringFlow";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { RequestKey } from "@/models/RequestKey";
import { idParams, makeUser, read, signInAs } from "./helpers";

const HANDLERS: Record<string, (req: NextRequest, ctx: ReturnType<typeof idParams>) => Promise<Response>> = { fire, verify, escalate, dismiss };

function keyed(path: string, body: unknown, key?: string) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body),
  });
}

async function alarm(): Promise<string> {
  const res = await read(await createAlarm(new NextRequest("http://localhost/api/alarms", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Exam", scheduledTime: new Date(Date.now() + 60_000).toISOString() }),
  })));
  return String(res.body.data._id);
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const events = async (alarmId: string) => (await BehaviorEvent.find({ "meta.alarmId": alarmId }).lean<{ type: string }[]>()).map((e) => e.type).sort();
const count = (alarmId: string, type: string) => BehaviorEvent.countDocuments({ "meta.alarmId": alarmId, type });

describe("a ring's results, sent again after the answer was lost", () => {
  it("are recorded once: the outbox's resend is answered from the first time", async () => {
    signInAs(await makeUser());
    const id = await alarm();
    const outbox = new Outbox(memoryStore(), "outbox");
    outbox.enqueue(syncCalls(id, {
      snoozed: false, responseMs: 6000, timeOnTaskMs: 5000, steps: 3, challenged: true, methods: ["math"],
      attempts: 0, solved: true, correctness: 1, escalationLevel: 2, backups: [],
    }));
    // The server does each call, then the connection drops before the answer comes back.
    const lostAnswers = async (entry: OutboxEntry): Promise<never> => {
      const action = entry.path.split("/").pop()!;
      await HANDLERS[action](keyed(entry.path, entry.body ?? {}, entry.id), idParams(id));
      throw new TypeError("network connection was lost");
    };
    expect(await outbox.flush(lostAnswers)).toMatchObject({ sent: 0, stalled: true });
    // Only the first call reached the server before the outbox stopped for the lost answer.
    const afterFirst = await events(id);

    const replayed: boolean[] = [];
    const back = async (entry: OutboxEntry) => {
      const action = entry.path.split("/").pop()!;
      const res = await HANDLERS[action](keyed(entry.path, entry.body ?? {}, entry.id), idParams(id));
      replayed.push(res.headers.get(REPLAYED_HEADER) === "true");
      return res;
    };
    expect(await outbox.flush(back)).toMatchObject({ sent: 4, stalled: false });
    expect(replayed).toEqual([true, false, false, false]);
    expect(afterFirst).toEqual(["alarm_fire"]);
    const all = await events(id);
    expect(all.filter((t) => t === "alarm_fire")).toHaveLength(1);
    expect(all.filter((t) => t === "dismiss")).toHaveLength(1);
  });

  it("a call sent twice gets the same answer twice, and the work is done once", async () => {
    signInAs(await makeUser());
    const id = await alarm();
    const first = await fire(keyed(`/api/alarms/${id}/fire`, {}, "ring-key-0001"), idParams(id));
    const second = await fire(keyed(`/api/alarms/${id}/fire`, {}, "ring-key-0001"), idParams(id));
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get(REPLAYED_HEADER)).toBe("true");
    expect(await count(id, "alarm_fire")).toBe(1);
  });

  it("without a key, behaves exactly as before (the page's own forms, older apps)", async () => {
    signInAs(await makeUser());
    const id = await alarm();
    await fire(keyed(`/api/alarms/${id}/fire`, {}), idParams(id));
    await fire(keyed(`/api/alarms/${id}/fire`, {}), idParams(id));
    expect(await count(id, "alarm_fire")).toBe(2);
    expect(await RequestKey.countDocuments()).toBe(0);
  });
});

describe("the rules for a key", () => {
  it("one key belongs to one request; a malformed key is refused", async () => {
    signInAs(await makeUser());
    const id = await alarm();
    await fire(keyed(`/api/alarms/${id}/fire`, {}, "shared-key-01"), idParams(id));
    expect((await dismiss(keyed(`/api/alarms/${id}/dismiss`, {}, "shared-key-01"), idParams(id))).status).toBe(422);
    expect((await fire(keyed(`/api/alarms/${id}/fire`, {}, "bad key!"), idParams(id))).status).toBe(400);
  });

  it("keys are each account's own: another account's same key is its own call", async () => {
    const a = await makeUser();
    const b = await makeUser();
    signInAs(a);
    const idA = await alarm();
    await fire(keyed(`/api/alarms/${idA}/fire`, {}, "same-key-1234"), idParams(idA));
    signInAs(b);
    const idB = await alarm();
    const res = await fire(keyed(`/api/alarms/${idB}/fire`, {}, "same-key-1234"), idParams(idB));
    expect(res.headers.get(REPLAYED_HEADER)).toBeNull();
    expect(await count(idB, "alarm_fire")).toBe(1);
  });

  it("while the first copy is still being handled, the second is told to come back (425, which outboxes retry)", async () => {
    const user = await makeUser();
    signInAs(user);
    const id = await alarm();
    await RequestKey.create({ userId: user, key: "in-flight-0001", path: `/api/alarms/${id}/fire`, state: "pending", createdAt: new Date() });
    expect((await fire(keyed(`/api/alarms/${id}/fire`, {}, "in-flight-0001"), idParams(id))).status).toBe(425);
    // One left pending by a server that stopped mid-request is given up after a while.
    await RequestKey.updateOne({ key: "in-flight-0001" }, { $set: { createdAt: new Date(Date.now() - 3 * 60_000) } });
    expect((await fire(keyed(`/api/alarms/${id}/fire`, {}, "in-flight-0001"), idParams(id))).status).toBe(200);
    expect(await count(id, "alarm_fire")).toBe(1);
  });

  it("a first try that failed on the server leaves nothing behind, so the retry does the work", async () => {
    signInAs(await makeUser());
    let calls = 0;
    const flaky = withIdempotency(async () => {
      calls++;
      return calls === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ ok: true, n: calls }), { status: 200 });
    });
    const req = () => keyed("/api/x", {}, "flaky-key-001");
    expect((await flaky(req(), {})).status).toBe(503);
    expect(await RequestKey.countDocuments()).toBe(0);
    expect(await (await flaky(req(), {})).json()).toEqual({ ok: true, n: 2 });
    expect(await (await flaky(req(), {})).json()).toEqual({ ok: true, n: 2 });
    expect(calls).toBe(2);
  });
});
