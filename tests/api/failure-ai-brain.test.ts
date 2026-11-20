// Failure mode 1 of 3 (prompt 7.3): the AI Brain is down.
//
// A real socket plays the AI Brain, failing in each way it can: nothing
// listening (connection refused), listening but never answering (a hang,
// cut off by the app's timeout), answering half and dropping the connection
// (network lost mid-answer), and answering with its own error. In each, every
// route that can reach it answers clearly (never a 500, never a hang), the
// routes that ask it fall back to the app's own rules or say it's offline,
// and an alarm is still set, rings and is stopped.
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PORT = vi.hoisted(() => {
  const port = 41_000 + (process.pid % 2000);
  process.env.AI_BRAIN_URL = `http://127.0.0.1:${port}`;
  process.env.AI_BRAIN_TIMEOUT_MS = "300";
  return port;
});

import { POST as createAlarm } from "@/app/api/alarms/route";
import { POST as fire } from "@/app/api/alarms/[id]/fire/route";
import { POST as dismiss } from "@/app/api/alarms/[id]/dismiss/route";
import { POST as schedule } from "@/app/api/ai/schedule/route";
import { POST as semantic } from "@/app/api/ai/semantic/route";
import { POST as sleepPrediction } from "@/app/api/ai/sleep-prediction/route";
import { POST as wakePlan } from "@/app/api/ai/wake-plan/route";
import { GET as weekly } from "@/app/api/analytics/weekly/route";
import { POST as feedback } from "@/app/api/feedback/route";
import { GET as recommendations } from "@/app/api/recommendations/route";
import { POST as createTask } from "@/app/api/tasks/route";
import { ErrorEvent } from "@/models/ErrorEvent";
import { idParams, makeUser, read, request, signInAs } from "./helpers";
import { answeredClearly, everyRoute, routesReaching } from "./sweep";

type Mode = "refused" | "hangs" | "drops mid-answer" | "answers with an error";
const MODES: Mode[] = ["refused", "hangs", "drops mid-answer", "answers with an error"];

/** The stand-in AI Brain: a socket that fails as told. */
const brain = {
  server: null as net.Server | null,
  mode: "refused" as Mode,
  asked: 0,
  sockets: new Set<net.Socket>(),
};

function listen(): Promise<void> {
  return new Promise((resolve) => {
    brain.server = net.createServer((socket) => {
      brain.sockets.add(socket);
      socket.on("close", () => brain.sockets.delete(socket));
      socket.once("data", () => {
        brain.asked++;
        if (brain.mode === "drops mid-answer") {
          socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 400\r\n\r\n{\"predicted");
          socket.destroy();
        }
        else if (brain.mode === "answers with an error") {
          const body = JSON.stringify({ error: "internal", errorId: "abc123", kind: "ValueError", message: "bad row for sleeper@example.org", where: "/predict/sleep", stack: "" });
          socket.end(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        }
        // "hangs": say nothing; the app's timeout must give up.
      });
    });
    brain.server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

async function become(mode: Mode) {
  brain.mode = mode;
  brain.asked = 0;
  const listening = brain.server !== null;
  if (mode === "refused" && listening) {
    for (const s of brain.sockets) {
      s.destroy();
    }
    await new Promise<void>((r) => brain.server!.close(() => r()));
    brain.server = null;
  }
  if (mode !== "refused" && !listening) {
    await listen();
  }
}

afterAll(async () => {
  await become("refused");
});

/** Calls a route and times it. */
async function timed(call: () => Promise<Response>) {
  const t0 = Date.now();
  const res = await call();
  return { res, ms: Date.now() - t0 };
}

describe.each(MODES)("with the AI Brain %s", (mode) => {
  beforeAll(async () => {
    await become(mode);
  });

  it("the routes that ask it fall back to the app's own rules, or say plainly it's offline", async () => {
    const me = await makeUser();
    signInAs(me);
    await read(await createTask(request("POST", "/api/tasks", { title: "Physics exam", dueDate: new Date(Date.now() + 86_400_000).toISOString(), priority: "high" })));
    const asks: [string, () => Promise<Response>][] = [
      ["semantic", () => semantic(request("POST", "/api/ai/semantic", { text: "Physics exam at 9 tomorrow" }))],
      ["sleep prediction", () => sleepPrediction(request("POST", "/api/ai/sleep-prediction", {}))],
      ["schedule", () => schedule(request("POST", "/api/ai/schedule", { mode: "assisted" }))],
      ["recommendations", () => recommendations(request("GET", "/api/recommendations"))],
      ["feedback", () => feedback(request("POST", "/api/feedback", { outcome: "success" }))],
      ["weekly analytics", () => weekly()],
      ["a new task", () => createTask(request("POST", "/api/tasks", { title: "Dentist" }))],
    ];
    for (const [name, call] of asks) {
      const { res, ms } = await timed(call);
      expect(await answeredClearly(res.clone()), name).toBeNull();
      expect(res.status, `${name}: ${await res.clone().text()}`).toBeLessThan(400);
      expect(ms, `${name} took ${ms} ms`).toBeLessThan(5_000);
    }
    // The planner has no rules of its own: it says so, in words, with a 503.
    const plan = await read(await wakePlan(request("POST", "/api/ai/wake-plan", { requiredReliability: 0.9, wakeTime: "05:40" })));
    expect(plan.status).toBe(503);
    expect(plan.body.error).toBe("The wake planner is offline right now. Try again once the AI service is back.");
    if (mode !== "refused") {
      expect(brain.asked, "the AI Brain was really asked").toBeGreaterThan(0);
    }
  });

  it("an alarm is still set with a full plan, rings and is stopped", async () => {
    signInAs(await makeUser());
    const made = await read(await createAlarm(request("POST", "/api/alarms", { label: "Exam", scheduledTime: new Date(Date.now() + 60_000).toISOString() })));
    expect(made.status).toBe(201);
    const plan = made.body.data.ringPlan;
    expect(plan.decidedBy).toBe("fallback");
    expect(plan.escalation.length).toBeGreaterThan(0);
    expect(plan.challenge.required).toBe(true);
    const id = String(made.body.data._id);
    expect((await fire(request("POST", `/api/alarms/${id}/fire`, {}), idParams(id))).status).toBe(200);
    expect((await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { responseMs: 4000 }), idParams(id))).status).toBe(200);
  });

  it("every route that can reach it answers clearly and in time", async () => {
    signInAs(await makeUser());
    const reaching = new Set(routesReaching("lib/aiClient.ts"));
    expect(reaching.size).toBeGreaterThan(10);
    const failures: string[] = [];
    for (const r of (await everyRoute()).filter((x) => reaching.has(x.key))) {
      const { res, ms } = await timed(r.call);
      const problem = await answeredClearly(res);
      if (problem || ms > 5_000) {
        failures.push(`${r.method} /api/${r.key}: ${problem ?? `took ${ms} ms`}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("the AI Brain's own errors", () => {
  it("are recorded by the app's error tracking, scrubbed, while the user still gets an answer", async () => {
    await become("answers with an error");
    signInAs(await makeUser());
    expect((await sleepPrediction(request("POST", "/api/ai/sleep-prediction", {}))).status).toBe(200);
    const stored = await ErrorEvent.findOne({ source: "ai-brain" }).lean<{ kind: string; message: string; where: string }>();
    expect(stored).toMatchObject({ kind: "ValueError", message: "bad row for <email>" });
  });
});
