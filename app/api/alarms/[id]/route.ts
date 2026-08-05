import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";

const ALLOWED_FIELDS = [
  "label",
  "scheduledTime",
  "source",
  "linkedTaskId",
  "intensity",
  "wakeStrategy",
  "verificationRequired",
  "verificationMethod",
  "verificationMethods",
  "minConfidence",
  "repeat",
  "status",
  "enabled",
  "lastSnoozeCount",
] as const;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const doc = await Alarm.findOne({ _id: id, userId }).lean();
    if (!doc) {
      return jsonError("Alarm not found", 404);
    }
    return jsonOk(doc);
  });
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const body = await parseJson<Record<string, unknown>>(req);
    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }
    const update: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in body) {
        update[key] = body[key];
      }
    }
    if (typeof update.scheduledTime === "string") {
      const d = new Date(update.scheduledTime);
      if (Number.isNaN(d.getTime())) {
        return jsonError("Invalid scheduledTime", 422);
      }
      update.scheduledTime = d;
    }
    const doc = await Alarm.findOneAndUpdate({ _id: id, userId }, { $set: update }, { new: true }).lean();
    if (!doc) {
      return jsonError("Alarm not found", 404);
    }
    return jsonOk(doc);
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return guard(async () => {
    return PUT(req, context);
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const doc = await Alarm.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) {
      return jsonError("Alarm not found", 404);
    }
    return jsonOk({ deleted: true });
  });
}