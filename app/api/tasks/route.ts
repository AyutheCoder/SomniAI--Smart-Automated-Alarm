import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Task } from "@/models/Task";
import { analyzeSemantic } from "@/lib/aiClient";
import { parseWhen } from "@/lib/whenParser";

interface CreateTaskBody {
  title?: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  category?: string;
  priority?: "low" | "medium" | "high" | "critical";
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const completed = searchParams.get("completed");
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
    const filter: Record<string, unknown> = { userId };
    if (q) {
      filter.$text = { $search: q };
    }
    if (completed === "true") {
      filter.completed = true;
    }
    if (completed === "false") {
      filter.completed = false;
    }
    const [items, total] = await Promise.all([
      Task.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter),
    ]);
    return jsonOk({ items, total, page, limit });
  });
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = await parseJson<CreateTaskBody>(req);
    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }
    const title = (body.title || "").trim();
    if (!title) {
      return jsonError("Title is required", 422);
    }
    const analysisText = [title, body.description].filter(Boolean).join(". ");
    let semantic;
    try {
      semantic = (await analyzeSemantic(analysisText)).data;
    } catch {
      semantic = undefined;
    }

    // "final exam tomorrow" carries a date the user never typed into the picker.
    // Without one the scheduler drops the task entirely, so read it out of the
    // sentence - but never override what the user picked explicitly.
    const when = body.dueDate ? {} : parseWhen(analysisText);

    const doc = await Task.create({
      userId,
      title,
      description: body.description || "",
      dueDate: body.dueDate || when.dueDate || undefined,
      dueTime: body.dueTime || when.dueTime || undefined,
      /** Set when the date came from the wording rather than the picker. */
      dueFromText: when.dueDate ? when.matched : undefined,
      category: body.category || "Personal",
      priority: body.priority || "medium",
      aiPriority: semantic?.suggestedPriority,
      importanceScore: semantic?.importanceScore,
      stressScore: semantic?.stressScore,
      intent: semantic?.intent,
      emotion: semantic?.emotion,
    });
    return jsonOk(doc, { status: 201 });
  });
}