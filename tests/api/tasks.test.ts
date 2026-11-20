import { beforeEach, describe, expect, it } from "vitest";
import { GET as list, POST as create } from "@/app/api/tasks/route";
import { DELETE as remove, GET as getOne, PATCH as patch, PUT as put } from "@/app/api/tasks/[id]/route";
import { Task } from "@/models/Task";
import { MISSING_ID, idParams, read, request, signInAs, twoUsers } from "./helpers";

async function taskFor(userId: string, fields: Record<string, unknown> = {}) {
  return String((await Task.create({ userId, title: "Thing", ...fields }))._id);
}

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("GET /api/tasks", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await list(request("GET", "/api/tasks"))).status).toBe(401);
  });

  it("lists, searches and filters only the caller's tasks", async () => {
    await Task.init(); // the text index must exist before a $text search
    await taskFor(alice, { title: "Physics exam" });
    await taskFor(alice, { title: "Buy milk", completed: true });
    await taskFor(bob, { title: "Bob's physics exam" });
    signInAs(alice);

    const all = await read(await list(request("GET", "/api/tasks")));
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(2);

    const search = await read(await list(request("GET", "/api/tasks?q=physics")));
    expect(search.body.data.items.map((t: { title: string }) => t.title)).toEqual(["Physics exam"]);

    const open = await read(await list(request("GET", "/api/tasks?completed=false")));
    expect(open.body.data.items.map((t: { title: string }) => t.title)).toEqual(["Physics exam"]);
  });
});

describe("POST /api/tasks", () => {
  it("rejects an unauthenticated request without writing", async () => {
    expect((await create(request("POST", "/api/tasks", { title: "x" }))).status).toBe(401);
    expect(await Task.countDocuments()).toBe(0);
  });

  it.each([
    ["malformed JSON", "{", 400, /Invalid JSON/],
    ["a missing title", { description: "x" }, 422, /Title is required/],
    ["an unknown priority", { title: "x", priority: "urgent!!" }, 422, /Priority is not one of the allowed values/],
    ["a title over 200 characters", { title: "t".repeat(201) }, 422, /200 characters/],
    ["a due date that is not a date", { title: "x", dueDate: "next week" }, 422, /dueDate must be a date like 2026-10-22/],
    ["an impossible due date", { title: "x", dueDate: "2026-02-31" }, 422, /dueDate must be a date/],
    ["a due time that is not a time", { title: "x", dueDate: "2026-10-22", dueTime: "9am" }, 422, /dueTime must be a 24-hour time like 07:30/],
  ])("rejects %s with a clear error", async (_what, body, status, message) => {
    signInAs(alice);
    const res = await read(await create(request("POST", "/api/tasks", body)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(await Task.countDocuments()).toBe(0);
  });

  it("creates a task for the caller and analyses it locally", async () => {
    signInAs(alice);
    const res = await read(await create(request("POST", "/api/tasks", {
      title: "Final exam", dueDate: "2026-11-02", dueTime: "09:00", priority: "high", userId: bob,
    })));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: alice, title: "Final exam", dueDate: "2026-11-02", dueTime: "09:00" });
    expect(typeof res.body.data.importanceScore).toBe("number");
  });
});

describe("GET /api/tasks/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    const id = await taskFor(alice);
    expect((await getOne(request("GET", `/api/tasks/${id}`), idParams(id))).status).toBe(401);
  });

  it("rejects a malformed id", async () => {
    signInAs(alice);
    expect((await getOne(request("GET", "/api/tasks/x"), idParams("x"))).status).toBe(400);
  });

  it("returns the caller's task", async () => {
    const id = await taskFor(alice, { title: "Mine" });
    signInAs(alice);
    expect((await read(await getOne(request("GET", `/api/tasks/${id}`), idParams(id)))).body.data.title).toBe("Mine");
  });

  it("answers 404 for another user's task, the same as for a missing one", async () => {
    const id = await taskFor(bob);
    signInAs(alice);
    const foreign = await read(await getOne(request("GET", `/api/tasks/${id}`), idParams(id)));
    const missing = await read(await getOne(request("GET", `/api/tasks/${MISSING_ID}`), idParams(MISSING_ID)));
    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
  });
});

describe.each([
  ["PUT", put],
  ["PATCH", patch],
])("%s /api/tasks/[id]", (method, handler) => {
  it("rejects an unauthenticated request", async () => {
    const id = await taskFor(alice);
    expect((await handler(request(method, `/api/tasks/${id}`, { title: "y" }), idParams(id))).status).toBe(401);
    expect((await Task.findById(id).lean<{ title: string }>())?.title).toBe("Thing");
  });

  it.each([
    ["a JSON array", [1], 400, /Invalid JSON/],
    ["a blank title", { title: " " }, 422, /Title is required/],
    ["an unknown priority", { priority: "whenever" }, 422, /Priority is not one of the allowed values/],
    ["completed as a string", { completed: "yes" }, 422, /completed must be true or false/],
    ["a bad due date", { dueDate: "31/12/2026" }, 422, /dueDate must be a date/],
  ])("rejects %s and leaves the task alone", async (_what, body, status, message) => {
    const id = await taskFor(alice, { priority: "low" });
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/tasks/${id}`, body), idParams(id)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(await Task.findById(id).lean()).toMatchObject({ title: "Thing", priority: "low", completed: false });
  });

  it("completes and un-completes a task, clearing completedAt", async () => {
    const id = await taskFor(alice);
    signInAs(alice);
    const done = await read(await handler(request(method, `/api/tasks/${id}`, { completed: true }), idParams(id)));
    expect(done.body.data.completed).toBe(true);
    expect(done.body.data.completedAt).toBeTruthy();

    const undone = await read(await handler(request(method, `/api/tasks/${id}`, { completed: false }), idParams(id)));
    expect(undone.body.data.completed).toBe(false);
    expect(undone.body.data.completedAt).toBeUndefined();
  });

  it("ignores fields outside the allowed set", async () => {
    const id = await taskFor(alice);
    signInAs(alice);
    const res = await read(await handler(request(method, `/api/tasks/${id}`, { title: "New", userId: bob, importanceScore: 100 }), idParams(id)));
    expect(res.body.data).toMatchObject({ title: "New", userId: alice });
    expect(res.body.data.importanceScore).not.toBe(100);
  });

  it("cannot change another user's task", async () => {
    const id = await taskFor(bob, { title: "Bob's" });
    signInAs(alice);
    expect((await handler(request(method, `/api/tasks/${id}`, { title: "Mine now" }), idParams(id))).status).toBe(404);
    expect((await Task.findById(id).lean<{ title: string }>())?.title).toBe("Bob's");
  });
});

describe("DELETE /api/tasks/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    const id = await taskFor(alice);
    expect((await remove(request("DELETE", `/api/tasks/${id}`), idParams(id))).status).toBe(401);
    expect(await Task.countDocuments()).toBe(1);
  });

  it("rejects a malformed id", async () => {
    signInAs(alice);
    expect((await remove(request("DELETE", "/api/tasks/x"), idParams("x"))).status).toBe(400);
  });

  it("deletes the caller's task", async () => {
    const id = await taskFor(alice);
    signInAs(alice);
    expect((await remove(request("DELETE", `/api/tasks/${id}`), idParams(id))).status).toBe(200);
    expect(await Task.countDocuments()).toBe(0);
  });

  it("cannot delete another user's task", async () => {
    const id = await taskFor(bob);
    signInAs(alice);
    expect((await remove(request("DELETE", `/api/tasks/${id}`), idParams(id))).status).toBe(404);
    expect(await Task.countDocuments()).toBe(1);
  });
});
