import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { isNum } from "@/lib/validate";

const ALLOWED_TYPES = new Set([
  "screen_on",
  "screen_off",
  "interaction",
  "snooze",
  "dismiss",
  "verify_pass",
  "verify_fail",
  "alarm_fire",
  "motion",
  "ambient_noise",
  "escalation",
]);

type EventSource = "live" | "simulated";

interface EventInput {
  type?: string;
  value?: number;
  meta?: Record<string, unknown>;
  at?: string;
  source?: EventSource;
}

interface EventsBody {
  events?: EventInput[];
  type?: string;
  value?: number;
  meta?: Record<string, unknown>;
  at?: string;
  /** Applies to every event in the batch that doesn't give its own. */
  source?: EventSource;
}

const EVENT_SOURCES: readonly string[] = ["live", "simulated"];

const MAX_BATCH = 200;

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<EventsBody>(req);
    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }

    const raw: EventInput[] = Array.isArray(body.events)
      ? body.events
      : body.type
        ? [{ type: body.type, value: body.value, meta: body.meta, at: body.at, source: body.source }]
        : [];

    if (raw.length === 0) {
      return jsonError("No events provided", 422);
    }
    if (raw.length > MAX_BATCH) {
      return jsonError(`Too many events (max ${MAX_BATCH})`, 422);
    }

    const docs = [];
    for (const e of raw) {
      // A null in the batch used to crash the route on `e.type` with a 500.
      if (e === null || typeof e !== "object" || Array.isArray(e)) {
        return jsonError("Each event must be an object", 422);
      }
      if (!e.type || !ALLOWED_TYPES.has(e.type)) {
        return jsonError(`Unknown event type: ${e.type ?? "(missing)"}`, 422);
      }
      if (e.value !== undefined && !isNum(e.value)) {
        return jsonError("value must be a number", 422);
      }
      const at = e.at ? new Date(e.at) : new Date();
      if (Number.isNaN(at.getTime())) {
        return jsonError("Invalid event timestamp", 422);
      }
      // Required, not defaulted: only the sender knows whether a reading came
      // from a real sensor, and a simulated one must never be taken for live.
      const source = e.source ?? body.source;
      if (!source || !EVENT_SOURCES.includes(source)) {
        return jsonError("Each event needs a source: live or simulated", 422);
      }
      docs.push({
        userId,
        type: e.type,
        value: e.value,
        meta: e.meta ?? undefined,
        source,
        at,
      });
    }

    await connectToDatabase();
    const inserted = await BehaviorEvent.insertMany(docs);
    return jsonOk({ inserted: inserted.length }, { status: 201 });
  });
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const since = searchParams.get("since");
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 100));
    const filter: Record<string, unknown> = { userId };
    // A filter that can't be applied is an error, not a reason to drop it and
    // hand back every event while the caller believes they were filtered.
    if (type) {
      if (!ALLOWED_TYPES.has(type)) {
        return jsonError(`Unknown event type: ${type}`, 422);
      }
      filter.type = type;
    }
    if (since) {
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) {
        return jsonError("since must be a date", 422);
      }
      filter.at = { $gte: sinceDate };
    }
    const items = await BehaviorEvent.find(filter).sort({ at: -1 }).limit(limit).lean();
    return jsonOk({ items, total: items.length });
  });
}