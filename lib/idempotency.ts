// Calls that are safe to send twice (prompt 7.3, "network lost mid-request").
//
// The phone's and the page's outboxes send what happened at ring time once
// the ring is over, and send it again until they get an answer. When the
// connection drops after the server has done the work but before the answer
// arrives, the second send used to record the ring a second time (two "fire"
// events, two dismissals in the morning report). Now each outbox call carries
// its queue id as an Idempotency-Key, and a key the server has seen gets the
// first answer back, word for word, without the work being done again.
//
// While the first send is still being worked on, a second one is answered 425
// (Too Early), which both outboxes retry later. A first send that failed with
// a 5xx leaves no key, so its retry does the work. A key left "pending" by a
// server that died mid-request is given up after PENDING_STALE_MS.
//
// Calls without the header (older apps, the page's own forms) behave as before.

import type { NextRequest } from "next/server";
import { guard, jsonError } from "@/lib/http";
import { getUserId } from "@/lib/session";

export const KEY_HEADER = "idempotency-key";
export const REPLAYED_HEADER = "idempotent-replayed";
export const PENDING_STALE_MS = 2 * 60_000;
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler so that a call repeated with the same key is answered from the first. */
export function withIdempotency<C>(handler: Handler<C>): Handler<C> {
  // In guard: with the database down, remembering the key fails as a 503 like any route, never a crash.
  return (req, ctx) => guard(async () => {
    const key = req.headers.get(KEY_HEADER);
    if (key === null) {
      return handler(req, ctx);
    }
    if (!KEY.test(key)) {
      return jsonError("Idempotency-Key must be 8 to 100 letters, digits, - or _", 400);
    }
    const userId = await getUserId();
    if (!userId) {
      // Unauthenticated calls are the handler's to refuse; nothing to remember.
      return handler(req, ctx);
    }
    const { connectToDatabase } = await import("@/lib/mongoose");
    const { RequestKey } = await import("@/models/RequestKey");
    await connectToDatabase();
    const path = req.nextUrl.pathname;
    const now = new Date();

    type Seen = { path: string; state: string; status?: number; body?: string; createdAt: Date };
    for (let attempt = 0; attempt < 2; attempt++) {
      // Claimed atomically: the upsert inserts the key and returns nothing if it was new, or
      // returns the key as it was if it had been seen. (The unique index backs this up under
      // concurrency; it may not be built yet on a fresh database, which this doesn't depend on.)
      let seen: Seen | null;
      try {
        seen = await RequestKey.findOneAndUpdate(
          { userId, key },
          { $setOnInsert: { userId, key, path, state: "pending", createdAt: now } },
          { upsert: true, new: false },
        ).lean<Seen>();
      }
      catch (e) {
        if ((e as { code?: number }).code !== 11000) {
          throw e;
        }
        seen = await RequestKey.findOne({ userId, key }).lean<Seen>();
      }
      if (!seen) {
        break; // Ours: do the work.
      }
      if (seen.path !== path) {
        return jsonError("This Idempotency-Key was already used for a different request", 422);
      }
      if (seen.state === "done") {
        return new Response(seen.body ?? "", {
          status: seen.status ?? 200,
          headers: { "content-type": "application/json", [REPLAYED_HEADER]: "true" },
        });
      }
      if (now.getTime() - new Date(seen.createdAt).getTime() < PENDING_STALE_MS) {
        return jsonError("The first copy of this request is still being handled. Try again shortly.", 425);
      }
      // Left pending by a server that stopped mid-request: claim it afresh.
      await RequestKey.deleteOne({ userId, key, state: "pending" });
    }

    let res: Response;
    try {
      res = await handler(req, ctx);
    }
    catch (e) {
      await RequestKey.deleteOne({ userId, key }).catch(() => {});
      throw e;
    }
    if (res.status >= 500) {
      // Not done: the retry must do the work.
      await RequestKey.deleteOne({ userId, key }).catch(() => {});
      return res;
    }
    const body = await res.clone().text();
    await RequestKey.updateOne({ userId, key }, { $set: { state: "done", status: res.status, body } }).catch(() => {});
    return res;
  });
}
