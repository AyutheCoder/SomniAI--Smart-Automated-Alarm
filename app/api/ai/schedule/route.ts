import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals } from "@/lib/aiFeatures";
import { predictSleep, predictWakeSuccess } from "@/lib/aiClient";
import {
  proposeAlarmsFromTasks,
  type SkippedTask,
  type AlarmPlan,
  type SchedulableTask,
  type SchedulerPrediction,
  type SchedulerProfile,
  type ExistingAlarmLite,
} from "@/lib/scheduler";
import { runLifecycle, type LifecycleSummary } from "@/lib/lifecycle";
import { Task } from "@/models/Task";
import { Alarm } from "@/models/Alarm";
import { User } from "@/models/User";

interface ScheduleBody {
  mode?: "assisted" | "autonomous";
  horizonDays?: number;
  taskIds?: string[];
  runMaintenance?: boolean;
}

const DEFAULT_PROFILE: SchedulerProfile = {
  chronotype: "intermediate",
  sleepGoalHours: 8,
  preferredWakeWindowMin: 30,
  defaultWakeStrategy: "adaptive",
  verificationRequired: true,
};

const NEUTRAL_PREDICTION: SchedulerPrediction = {
  predictedSleepDuration: 7.5,
  wakeupConsistency: 0.6,
  oversleepProbability: 0.3,
  wakeSuccessProbability: 0.7,
};

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<ScheduleBody>(req)) ?? {};
    const mode = body.mode === "autonomous" ? "autonomous" : "assisted";
    const horizonDays = clampHorizon(body.horizonDays);
    await connectToDatabase();
    let profile = DEFAULT_PROFILE;
    try {
      const user = await User.findById(userId).lean<{
        chronotype?: string;
        sleepGoalHours?: number;
        preferredWakeWindowMin?: number;
        preferences?: {
          defaultWakeStrategy?: SchedulerProfile["defaultWakeStrategy"];
          verificationRequired?: boolean;
        };
      }>();
      if (user) {
        profile = {
          chronotype: user.chronotype ?? DEFAULT_PROFILE.chronotype,
          sleepGoalHours: user.sleepGoalHours ?? DEFAULT_PROFILE.sleepGoalHours,
          preferredWakeWindowMin: user.preferredWakeWindowMin ?? DEFAULT_PROFILE.preferredWakeWindowMin,
          defaultWakeStrategy: user.preferences?.defaultWakeStrategy ?? DEFAULT_PROFILE.defaultWakeStrategy,
          verificationRequired: user.preferences?.verificationRequired ?? DEFAULT_PROFILE.verificationRequired,
        };
      }
    } catch {
      profile = DEFAULT_PROFILE;
    }

    const taskFilter: Record<string, unknown> = { userId, completed: false };
    if (Array.isArray(body.taskIds) && body.taskIds.length > 0) {
      taskFilter._id = { $in: body.taskIds };
    }

    const taskDocs = await Task.find(taskFilter).lean();
    const tasks: SchedulableTask[] = taskDocs.map((t) => {
      const doc = t as Record<string, unknown>;
      return {
        _id: String(doc._id),
        title: String(doc.title ?? ""),
        description: doc.description as string | undefined,
        dueDate: doc.dueDate as string | undefined,
        dueTime: doc.dueTime as string | undefined,
        category: doc.category as string | undefined,
        priority: (doc.priority as SchedulableTask["priority"]) ?? "medium",
        aiPriority: doc.aiPriority as SchedulableTask["priority"] | undefined,
        importanceScore: doc.importanceScore as number | undefined,
        intent: doc.intent as SchedulableTask["intent"] | undefined,
        emotion: doc.emotion as SchedulableTask["emotion"] | undefined,
        completed: Boolean(doc.completed),
      };
    });

    let prediction = NEUTRAL_PREDICTION;
    let predictionSource: "ai" | "fallback" = "fallback";
    try {
      const { features } = await buildUserSignals(userId);
      const [sleep, wake] = await Promise.all([
        predictSleep(features),
        predictWakeSuccess(features),
      ]);
      prediction = {
        predictedSleepDuration: sleep.data.predictedSleepDuration,
        wakeupConsistency: sleep.data.wakeupConsistency,
        oversleepProbability: wake.data.oversleepProbability,
        wakeSuccessProbability: wake.data.wakeSuccessProbability,
      };
      predictionSource = sleep.source === "ai" && wake.source === "ai" ? "ai" : "fallback";
    } catch {
      prediction = NEUTRAL_PREDICTION;
      predictionSource = "fallback";
    }

    const existingDocs = await Alarm.find({ userId, enabled: true })
      .select("scheduledTime enabled linkedTaskId")
      .lean();
    const existing: ExistingAlarmLite[] = existingDocs.map((a) => {
      const doc = a as Record<string, unknown>;
      return {
        scheduledTime: doc.scheduledTime as string | Date,
        enabled: Boolean(doc.enabled),
        linkedTaskId: doc.linkedTaskId ? String(doc.linkedTaskId) : undefined,
      };
    });

    // Collect the tasks that were passed over so the UI can say why, instead of
    // implying nothing qualified.
    const skipped: SkippedTask[] = [];
    const proposals = proposeAlarmsFromTasks(tasks, profile, prediction, existing, {
      horizonDays,
      source: mode,
      skipped,
    });

    if (mode === "assisted") {
      let maintenance: LifecycleSummary | undefined;
      if (body.runMaintenance) {
        maintenance = await runLifecycle(userId, new Date(), true);
      }
      return jsonOk({
        mode,
        predictionSource,
        prediction,
        proposals,
        skipped,
        created: [],
        maintenance,
      });
    }

    const created = await persistPlans(userId, proposals);
    const maintenance = body.runMaintenance === false ? undefined : await runLifecycle(userId, new Date());
    return jsonOk({
      mode,
      predictionSource,
      prediction,
      proposals,
      skipped,
      created,
      maintenance,
    });
  });
}

function clampHorizon(value: unknown): number {
  const n = typeof value === "number" ? value : 7;
  return Math.max(1, Math.min(30, Math.round(n)));
}

async function persistPlans(userId: string, plans: AlarmPlan[]) {
  const created: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    const doc = await Alarm.create({
      userId,
      label: plan.label,
      scheduledTime: new Date(plan.scheduledTime),
      source: "autonomous",
      linkedTaskId: plan.linkedTaskId,
      intensity: plan.intensity,
      wakeStrategy: plan.wakeStrategy,
      verificationRequired: plan.verificationRequired,
      verificationMethod: plan.verificationMethod,
      verificationMethods: plan.verificationMethods,
      minConfidence: plan.minConfidence,
      repeat: plan.repeat,
      decision: {
        summary: plan.explanation.summary,
        rationale: plan.explanation.rationale,
        attributions: plan.explanation.attributions,
        confidence: plan.explanation.confidence,
        decidedBy: "scheduler",
        at: new Date(),
      },
    });
    created.push(doc.toObject ? doc.toObject() : doc);
  }
  return created;
}