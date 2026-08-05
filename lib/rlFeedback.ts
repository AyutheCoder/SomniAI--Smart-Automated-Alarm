import { connectToDatabase } from "@/lib/mongoose";
import { RlPolicy } from "@/models/RlPolicy";
import { ModelFeedback } from "@/models/ModelFeedback";
import { rlUpdate, type FeedbackOutcome, type RlAction, type RlContext, type RlUpdateResult, } from "@/lib/aiClient";
import { explainRlDecision, type Explanation } from "@/lib/explain";
export interface RecordFeedbackInput {
  userId: string;
  // Optional: feedback can arrive detached from a specific alarm, and
  // ModelFeedback stores it without a `required` constraint.
  alarmId?: string;
  context: RlContext;
  action: Partial<RlAction>;
  outcome: FeedbackOutcome;
  snoozes?: number;
  ttwMin?: number;
  satisfaction?: number;
  reward?: number;
}
export interface RecordFeedbackResult {
  data: RlUpdateResult;
  source: "ai" | "fallback";
  explanation: Explanation;
}
export async function recordFeedback(input: RecordFeedbackInput): Promise<RecordFeedbackResult> {
  await connectToDatabase();
  const existing = await RlPolicy.findOne({ userId: input.userId }).lean();
  const prevPolicy = (existing as unknown as {
    policy?: Record<string, unknown>;
  } | null)
    ?.policy ?? null;
  const { data, source } = await rlUpdate({
    policy: prevPolicy,
    context: input.context,
    action: input.action,
    outcome: input.outcome,
    snoozes: input.snoozes,
    ttwMin: input.ttwMin,
    satisfaction: input.satisfaction,
    reward: input.reward,
  });
  await RlPolicy.findOneAndUpdate({ userId: input.userId }, {
    $set: {
      policy: data.policy,
      summary: data.summary,
      updates: data.summary.updates,
      meanReward: data.summary.meanReward,
    },
  }, { upsert: true, new: true });
  await ModelFeedback.create({
    userId: input.userId,
    alarmId: input.alarmId,
    context: input.context as Record<string, unknown>,
    action: input.action as Record<string, unknown>,
    outcome: input.outcome,
    reward: data.reward,
    source,
    at: new Date(),
  });
  const explanation = explainRlDecision(input.context, data.recommendedAction, {
    updates: data.summary.updates,
    meanReward: data.summary.meanReward,
    source,
  });
  return { data, source, explanation };
}