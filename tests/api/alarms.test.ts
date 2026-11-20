import { beforeEach, describe, expect, it } from "vitest";
import { GET as list, POST as create } from "@/app/api/alarms/route";
import { DELETE as remove, GET as getOne, PATCH as patch, PUT as put } from "@/app/api/alarms/[id]/route";
import { Alarm } from "@/models/Alarm";
import { Task } from "@/models/Task";
import { MISSING_ID, idParams, read, request, signInAs, twoUsers } from "./helpers";

const SOON = new Date(Date.now() + 3600_000).toISOString();

async function alarmFor(userId: string, fields: Record<string, unknown> = {}) {
  const doc = await Alarm.create({ userId, label: "Wake", scheduledTime: new Date(SOON), ...fields });
  return String(doc._id);
}

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("GET /api/alarms", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await read(await list(request("GET", "/api/alarms")));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("lists only the caller's alarms, filtered by enabled", async () => {
    await alarmFor(alice, { label: "Mine on" });
    await alarmFor(alice, { label: "Mine off", enabled: false });
    await alarmFor(bob, { label: "Bob's" });
    signInAs(alice);

    const all = await read(await list(request("GET", "/api/alarms")));
    expect(all.status).toBe(200);
    expect(all.body.data.items.map((a: { label: string }) => a.label).sort()).toEqual(["Mine off", "Mine on"]);

    const on = await read(await list(request("GET", "/api/alarms?enabled=true")));
    expect(on.body.data.items.map((a: { label: string }) => a.label)).toEqual(["Mine on"]);
  });
});

describe("POST /api/alarms", () => {
  it("rejects an unauthenticated request without writing", async () => {
    const res = await create(request("POST", "/api/alarms", { label: "x", scheduledTime: SOON }));
    expect(res.status).toBe(401);
    expect(await Alarm.countDocuments()).toBe(0);
  });

  it.each([
    ["malformed JSON", "{not json", 400, /Invalid JSON/],
    ["a non-object body", [1, 2], 400, /Invalid JSON/],
    ["a missing label", { scheduledTime: SOON }, 422, /Label is required/],
    ["a blank label", { label: "   ", scheduledTime: SOON }, 422, /Label is required/],
    ["a missing time", { label: "x" }, 422, /scheduledTime is required/],
    ["an unparseable time", { label: "x", scheduledTime: "tomorrowish" }, 422, /not a valid date/],
    ["intensity out of range", { label: "x", scheduledTime: SOON, intensity: 400 }, 422, /Intensity must be 100 or less/],
    ["an unknown strategy", { label: "x", scheduledTime: SOON, wakeStrategy: "violent" }, 422, /Wake strategy/],
    ["a label over 200 characters", { label: "a".repeat(201), scheduledTime: SOON }, 422, /200 characters/],
  ])("rejects %s with a clear error", async (_what, body, status, message) => {
    signInAs(alice);
    const res = await read(await create(request("POST", "/api/alarms", body)));
    expect(res.status).toBe(status);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(message);
    expect(await Alarm.countDocuments()).toBe(0);
  });

  it("creates an alarm owned by the caller, with defaults", async () => {
    signInAs(alice);
    const res = await read(await create(request("POST", "/api/alarms", { label: " Exam ", scheduledTime: SOON })));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      userId: alice,
      label: "Exam",
      intensity: 60,
      wakeStrategy: "adaptive",
      verificationMethods: ["math"],
      status: "scheduled",
      enabled: true,
    });
  });

  it("ignores a userId in the body: an alarm cannot be planted on someone else", async () => {
    signInAs(alice);
    const res = await read(await create(request("POST", "/api/alarms", { label: "x", scheduledTime: SOON, userId: bob })));
    expect(res.body.data.userId).toBe(alice);
    expect(await Alarm.countDocuments({ userId: bob })).toBe(0);
  });

  it("links a task only when the caller owns it", async () => {
    const bobsTask = await Task.create({ userId: bob, title: "Bob's exam" });
    const ownTask = await Task.create({ userId: alice, title: "My exam" });
    signInAs(alice);

    const foreign = await read(await create(request("POST", "/api/alarms", {
      label: "x", scheduledTime: SOON, linkedTaskId: String(bobsTask._id),
    })));
    expect(foreign.status).toBe(422);
    expect(foreign.body.error).toMatch(/linked task/i);

    const own = await read(await create(request("POST", "/api/alarms", {
      label: "x", scheduledTime: SOON, linkedTaskId: String(ownTask._id),
    })));
    expect(own.status).toBe(201);
    expect(own.body.data.linkedTaskId).toBe(String(ownTask._id));
  });
});

describe("GET /api/alarms/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    const id = await alarmFor(alice);
    expect((await getOne(request("GET", `/api/alarms/${id}`), idParams(id))).status).toBe(401);
  });

  it("rejects a malformed id", async () => {
    signInAs(alice);
    const res = await read(await getOne(request("GET", "/api/alarms/nope"), idParams("nope")));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid id");
  });

  it("returns the caller's alarm", async () => {
    const id = await alarmFor(alice, { label: "Mine" });
    signInAs(alice);
    const res = await read(await getOne(request("GET", `/api/alarms/${id}`), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe("Mine");
  });

  it("answers 404 for another user's alarm, the same as for a missing one", async () => {
    const id = await alarmFor(bob);
    signInAs(alice);
    const foreign = await read(await getOne(request("GET", `/api/alarms/${id}`), idParams(id)));
    const missing = await read(await getOne(request("GET", `/api/alarms/${MISSING_ID}`), idParams(MISSING_ID)));
    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
  });
});

describe.each([
  ["PUT", put],
  ["PATCH", patch],
])("%s /api/alarms/[id]", (method, handler) => {
  it("rejects an unauthenticated request without changing anything", async () => {
    const id = await alarmFor(alice, { label: "Before" });
    const res = await handler(request(method, `/api/alarms/${id}`, { label: "After" }), idParams(id));
    expect(res.status).toBe(401);
    expect((await Alarm.findById(id))?.label).toBe("Before");
  });

  it.each([
    ["malformed JSON", "{", 400, /Invalid JSON/],
    ["a JSON string instead of an object", "\"label\"", 400, /Invalid JSON/],
    ["an unparseable time", { scheduledTime: "soon" }, 422, /Invalid scheduledTime/],
    ["intensity out of range", { intensity: -5 }, 422, /Intensity must be 0 or more/],
    ["an unknown status", { status: "exploded" }, 422, /Status is not one of the allowed values/],
    ["a blank label", { label: "  " }, 422, /Label is required/],
    ["minConfidence over 100", { minConfidence: 101 }, 422, /Min confidence must be 100 or less/],
  ])("rejects %s with a clear error and leaves the alarm alone", async (_what, body, status, message) => {
    const id = await alarmFor(alice, { label: "Before", intensity: 60 });
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/alarms/${id}`, body), idParams(id)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    const after = await Alarm.findById(id).lean<{ label: string; intensity: number; status: string }>();
    expect(after).toMatchObject({ label: "Before", intensity: 60, status: "scheduled" });
  });

  it("updates allowed fields and ignores the rest", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/alarms/${id}`, {
      label: "Renamed",
      intensity: 90,
      enabled: false,
      userId: bob,
      createdAt: "2000-01-01T00:00:00Z",
    }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: "Renamed", intensity: 90, enabled: false, userId: alice });
    expect(new Date(res.body.data.createdAt).getFullYear()).not.toBe(2000);
  });

  it("cannot change another user's alarm", async () => {
    const id = await alarmFor(bob, { label: "Bob's" });
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/alarms/${id}`, { label: "Hijacked", enabled: false }), idParams(id)));
    expect(res.status).toBe(404);
    expect(await Alarm.findById(id).lean()).toMatchObject({ label: "Bob's", enabled: true });
  });

  it("cannot link another user's task", async () => {
    const id = await alarmFor(alice);
    const bobsTask = await Task.create({ userId: bob, title: "Bob's" });
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/alarms/${id}`, { linkedTaskId: String(bobsTask._id) }), idParams(id)));
    expect(res.status).toBe(422);
    expect((await Alarm.findById(id).lean<{ linkedTaskId?: string }>())?.linkedTaskId).toBeUndefined();
  });
});

describe("DELETE /api/alarms/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    const id = await alarmFor(alice);
    expect((await remove(request("DELETE", `/api/alarms/${id}`), idParams(id))).status).toBe(401);
    expect(await Alarm.countDocuments()).toBe(1);
  });

  it("rejects a malformed id", async () => {
    signInAs(alice);
    expect((await remove(request("DELETE", "/api/alarms/x"), idParams("x"))).status).toBe(400);
  });

  it("deletes the caller's alarm", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await remove(request("DELETE", `/api/alarms/${id}`), idParams(id)));
    expect(res).toEqual({ status: 200, body: { ok: true, data: { deleted: true } } });
    expect(await Alarm.countDocuments()).toBe(0);
  });

  it("cannot delete another user's alarm", async () => {
    const id = await alarmFor(bob);
    signInAs(alice);
    expect((await remove(request("DELETE", `/api/alarms/${id}`), idParams(id))).status).toBe(404);
    expect(await Alarm.countDocuments({ userId: bob })).toBe(1);
  });
});
