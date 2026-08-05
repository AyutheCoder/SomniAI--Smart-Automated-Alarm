import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { connectToDatabase } from "@/lib/mongoose";
import { SleepLog } from "@/models/SleepLog";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { RlPolicy } from "@/models/RlPolicy";
import { ModelFeedback } from "@/models/ModelFeedback";
import { buildWeeklyReport, type WeeklyReport } from "@/lib/weekly";
import { buildUserSignals } from "@/lib/aiFeatures";
import { buildInsights, type RlAction, type RlContext } from "@/lib/aiClient";
import { explainRlDecision, type Explanation } from "@/lib/explain";
import type { BehaviorEventInput, SleepLogInput } from "@/lib/features";

export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    let report: WeeklyReport;
    let logsLen = 0;
    try {
      await connectToDatabase();
      const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
      const [logsRaw, eventsRaw] = await Promise.all([
        SleepLog.find({ userId }).sort({ date: -1 }).limit(30).lean(),
        BehaviorEvent.find({ userId, at: { $gte: since } })
          .sort({ at: -1 })
          .limit(3000)
          .lean(),
      ]);
      const logs = logsRaw as unknown as SleepLogInput[];
      const events = eventsRaw as unknown as BehaviorEventInput[];
      logsLen = logs.length;
      report = buildWeeklyReport(logs, events);
    } catch {
      report = buildWeeklyReport([], []);
    }

    let coaching: Awaited<ReturnType<typeof buildInsights>> | null = null;
    try {
      const signals = await buildUserSignals(userId);
      coaching = await buildInsights({
        features: signals.features,
        metrics: report.metrics,
        recentSleepHours: signals.recentSleepHours,
        sleepGoalHours: signals.sleepGoalHours,
      });
    } catch {
      coaching = null;
    }

    let personalization: {
      updates: number;
      meanReward: number;
      summary: Record<string, unknown> | null;
      explanation: Explanation | null;
    } = { updates: 0, meanReward: 0, summary: null, explanation: null };
    try {
      const [pol, lastFeedback] = await Promise.all([
        RlPolicy.findOne({ userId }).lean(),
        ModelFeedback.findOne({ userId }).sort({ at: -1 }).lean(),
      ]);
      if (pol) {
        const p = pol as unknown as {
          updates?: number;
          meanReward?: number;
          summary?: {
            preferredAction?: RlAction;
          } & Record<string, unknown>;
        };
        let explanation: Explanation | null = null;
        const preferred = p.summary?.preferredAction;
        if (preferred) {
          const ctx = ((lastFeedback as unknown as {
            context?: RlContext;
          } | null)?.context) ?? {};
          explanation = explainRlDecision(ctx, preferred, {
            updates: p.updates ?? 0,
            meanReward: p.meanReward ?? 0,
          });
        }
        personalization = {
          updates: p.updates ?? 0,
          meanReward: p.meanReward ?? 0,
          summary: p.summary ?? null,
          explanation,
        };
      }
    } catch {
    }

    return jsonOk({
      report,
      coaching,
      personalization,
      hasData: logsLen > 0,
    });
  });
}