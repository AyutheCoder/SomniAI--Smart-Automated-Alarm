// What the escalation profile learns from (prompt 3.4): the morning reports,
// one per ring, newest first, and before the first report the `escalation`
// events that were the only record of a wake until then. Server-only.

import { deriveEscalationProfile, type EscalationProfile } from "@/lib/escalation";
import { levelsForProfile } from "@/lib/morningReport";
import { modelEventFilter } from "@/lib/provenance";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { WakeReport, type WakeReportDocument } from "@/models/WakeReport";

/** How many past rings the profile reads. */
export const PROFILE_WINDOW = 40;

export async function profileLevels(userId: string): Promise<number[]> {
  const reports = await WakeReport.find({ userId })
    .sort({ ringAt: -1 })
    .limit(PROFILE_WINDOW)
    .lean<Pick<WakeReportDocument, "outcome" | "level" | "rang">[]>();
  const levels = levelsForProfile(reports);
  if (reports.length >= PROFILE_WINDOW) {
    return levels;
  }
  // Rings from before reports existed: their escalation events, and only those,
  // so a ring that has a report isn't counted twice.
  const first = await WakeReport.findOne({ userId }).sort({ ringAt: 1 }).lean<{ ringAt: Date }>();
  const older = await BehaviorEvent.find({
    userId,
    type: "escalation",
    ...modelEventFilter(),
    ...(first ? { at: { $lt: first.ringAt } } : {}),
  })
    .sort({ at: -1 })
    .limit(PROFILE_WINDOW - reports.length)
    .lean<{ value?: number }[]>();
  return [
    ...levels,
    ...older.map((e) => Number(e.value)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5),
  ];
}

export async function currentProfile(userId: string): Promise<EscalationProfile> {
  return deriveEscalationProfile({ effectiveLevels: await profileLevels(userId) });
}
