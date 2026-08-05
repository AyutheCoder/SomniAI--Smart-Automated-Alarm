import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { makeExplanation, type Attribution, type Explanation } from "@/lib/explain";
const TERMINAL_STATUSES = ["dismissed", "verified", "missed", "completed"];
const STALE_AFTER_HOURS = 36;
const MS_PER_HOUR = 3600000;
const RECURRING_TYPES = ["daily", "weekdays", "custom"];
function clamp01(n: number): number {
  if (!Number.isFinite(n))
    return 0;
  return Math.max(0, Math.min(1, n));
}
export interface LifecycleAction {
  alarmId: string;
  label: string;
  action: "pruned" | "decluttered" | "optimized";
  detail: string;
  explanation: Explanation;
}
export interface LifecycleSummary {
  pruned: number;
  decluttered: number;
  optimized: number;
  actions: LifecycleAction[];
}
interface AlarmRow extends AlarmDocument {
  _id: {
    toString(): string;
  };
}
export async function runLifecycle(userId: string, now: Date = new Date(), dryRun = false): Promise<LifecycleSummary> {
  const alarms = (await Alarm.find({ userId }).lean()) as unknown as AlarmRow[];
  const actions: LifecycleAction[] = [];
  const toDelete: string[] = [];
  const summary: LifecycleSummary = {
    pruned: 0,
    decluttered: 0,
    optimized: 0,
    actions,
  };
  const nowMs = now.getTime();
  for (const alarm of alarms) {
    const id = alarm._id.toString();
    const repeatType = alarm.repeat?.type ?? "none";
    const isOneOff = repeatType === "none";
    const scheduledMs = new Date(alarm.scheduledTime).getTime();
    const isPast = !Number.isNaN(scheduledMs) && scheduledMs < nowMs;
    if (isOneOff && isPast && TERMINAL_STATUSES.includes(alarm.status)) {
      toDelete.push(id);
      summary.pruned += 1;
      const detail = `Removed completed one-off alarm (status: ${alarm.status}).`;
      actions.push({
        alarmId: id,
        label: alarm.label,
        action: "pruned",
        detail,
        explanation: makeExplanation({
          summary: "Pruned finished alarm",
          rationale: detail,
          attributions: [
            { feature: "Alarm status", value: alarm.status, impact: "increase", weight: 0.9, detail: "Alarm reached a terminal state." },
            { feature: "Schedule", value: "one-off, in the past", impact: "increase", weight: 0.6 },
          ],
        }),
      });
      continue;
    }
    const ageHours = (nowMs - scheduledMs) / MS_PER_HOUR;
    if (isOneOff &&
      isPast &&
      alarm.enabled &&
      (alarm.status === "scheduled" || alarm.status === "snoozed") &&
      ageHours > STALE_AFTER_HOURS) {
      summary.decluttered += 1;
      const detail = `Disabled stale alarm ${Math.round(ageHours)}h past with no resolution.`;
      actions.push({
        alarmId: id,
        label: alarm.label,
        action: "decluttered",
        detail,
        explanation: makeExplanation({
          summary: "Disabled stale alarm",
          rationale: detail,
          attributions: [
            { feature: "Age past due", value: `${Math.round(ageHours)} h`, impact: "increase", weight: clamp01(ageHours / (STALE_AFTER_HOURS * 2)), detail: `Older than the ${STALE_AFTER_HOURS}h staleness threshold.` },
            { feature: "Resolution", value: alarm.status, impact: "increase", weight: 0.7, detail: "Never acted on (no dismiss/verify)." },
          ],
        }),
      });
      if (!dryRun) {
        await Alarm.updateOne({ _id: id, userId }, { $set: { enabled: false, status: "missed" } });
      }
      continue;
    }
    if (RECURRING_TYPES.includes(repeatType) && alarm.enabled) {
      const snoozes = alarm.lastSnoozeCount ?? 0;
      let nextIntensity = alarm.intensity;
      let nextStrategy = alarm.wakeStrategy;
      let reason = "";
      if (snoozes >= 2 && alarm.intensity < 100) {
        nextIntensity = Math.min(100, alarm.intensity + 10);
        if (alarm.wakeStrategy === "gentle")
          nextStrategy = "adaptive";
        else if (alarm.wakeStrategy === "adaptive")
          nextStrategy = "aggressive";
        reason = `Increased intensity to ${nextIntensity} after ${snoozes} snoozes.`;
      }
      else if (snoozes === 0 && alarm.intensity > 40 && alarm.wakeStrategy !== "aggressive") {
        nextIntensity = Math.max(40, alarm.intensity - 5);
        reason = `Softened intensity to ${nextIntensity}; you woke without snoozing.`;
      }
      if (reason) {
        summary.optimized += 1;
        const tuned = snoozes >= 2;
        const attributions: Attribution[] = [
          {
            feature: "Recent snoozes",
            value: String(snoozes),
            impact: tuned ? "increase" : "decrease",
            weight: tuned ? clamp01(0.5 + snoozes * 0.15) : 0.5,
            detail: tuned
              ? "Repeated snoozing means the wake is too easy to ignore."
              : "You woke without snoozing, so the alarm can ease off.",
          },
          {
            feature: "Intensity",
            value: `${alarm.intensity} \u2192 ${nextIntensity}`,
            impact: nextIntensity > alarm.intensity ? "increase" : "decrease",
            weight: clamp01(Math.abs(nextIntensity - alarm.intensity) / 20),
          },
          {
            feature: "Strategy",
            value: nextStrategy === alarm.wakeStrategy ? alarm.wakeStrategy : `${alarm.wakeStrategy} \u2192 ${nextStrategy}`,
            impact: tuned ? "increase" : "neutral",
            weight: nextStrategy === alarm.wakeStrategy ? 0.2 : 0.5,
          }
        ];
        actions.push({
          alarmId: id,
          label: alarm.label,
          action: "optimized",
          detail: reason,
          explanation: makeExplanation({
            summary: tuned ? "Strengthened recurring alarm" : "Softened recurring alarm",
            rationale: reason,
            attributions,
          }),
        });
        if (!dryRun) {
          await Alarm.updateOne({ _id: id, userId }, { $set: { intensity: nextIntensity, wakeStrategy: nextStrategy } });
        }
      }
    }
  }
  if (!dryRun && toDelete.length > 0) {
    await Alarm.deleteMany({ _id: { $in: toDelete }, userId });
  }
  return summary;
}