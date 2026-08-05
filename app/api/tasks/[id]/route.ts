import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Task } from "@/models/Task";

const ALLOWED_FIELDS = [
  "title",
  "description",
  "dueDate",
  "dueTime",
  "category",
  "priority",
  "completed",
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
    const doc = await Task.findOne({ _id: id, userId }).lean();
    if (!doc) {
      return jsonError("Task not found", 404);
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

    if (update.completed === true) {
      update.completedAt = new Date();
    }
    if (update.completed === false) {
      update.completedAt = undefined;
    }

    const doc = await Task.findOneAndUpdate({ _id: id, userId }, { $set: update }, { new: true }).lean();
    if (!doc) {
      return jsonError("Task not found", 404);
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
    const doc = await Task.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) {
      return jsonError("Task not found", 404);
    }
    return jsonOk({ deleted: true });
  });
}