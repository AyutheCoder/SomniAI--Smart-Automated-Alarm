import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { BehaviorEvent } from "@/models/BehaviorEvent";

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

interface EventInput {
  type?: string;
  value?: number;
  meta?: Record<string, unknown>;
  at?: string;
}

interface EventsBody {
  events?: EventInput[];
  type?: string;
  value?: number;
  meta?: Record<string, unknown>;
  at?: string;
}

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
        ? [{ type: body.type, value: body.value, meta: body.meta, at: body.at }]
        : [];

    if (raw.length === 0) {
      return jsonError("No events provided", 422);
    }
    if (raw.length > MAX_BATCH) {
      return jsonError(`Too many events (max ${MAX_BATCH})`, 422);
    }

    const docs = [];
    for (const e of raw) {
      if (!e.type || !ALLOWED_TYPES.has(e.type)) {
        return jsonError(`Unknown event type: ${e.type ?? "(missing)"}`, 422);
      }
      const at = e.at ? new Date(e.at) : new Date();
      if (Number.isNaN(at.getTime())) {
        return jsonError("Invalid event timestamp", 422);
      }
      docs.push({
        userId,
        type: e.type,
        value: typeof e.value === "number" ? e.value : undefined,
        meta: e.meta ?? undefined,
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
    if (type && ALLOWED_TYPES.has(type)) {
      filter.type = type;
    }
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        filter.at = { $gte: sinceDate };
      }
    }
    const items = await BehaviorEvent.find(filter).sort({ at: -1 }).limit(limit).lean();
    return jsonOk({ items, total: items.length });
  });
}