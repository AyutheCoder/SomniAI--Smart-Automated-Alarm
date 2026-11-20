import { Schema, model, models } from "mongoose";
import type { WakeOutcome } from "@/lib/morningReport";
import type { WakeStage } from "@/lib/escalation";

/**
 * How one ring ended (prompt 3.4): the facts behind the morning report, and
 * what the escalation profile learns from. One per ring (alarm + when it was
 * due); the first record of a ring is kept, so a resent call changes nothing.
 */
export interface WakeReportDocument {
  userId: string;
  alarmId: string;
  label: string;
  ringAt: Date;
  outcome: WakeOutcome;
  level: number | null;
  levelLabel: string | null;
  stage: WakeStage | null;
  rang: boolean;
  endedAt: Date | null;
  verification: {
    required: boolean;
    passed: boolean | null;
    seconds: number | null;
    steps: number | null;
    score: number | null;
    threshold: number | null;
  };
  createdAt: Date;
}
const WakeReportSchema = new Schema<WakeReportDocument>({
  userId: { type: String, required: true, index: true },
  alarmId: { type: String, required: true },
  label: { type: String, required: true },
  ringAt: { type: Date, required: true },
  outcome: { type: String, enum: ["woke", "missed"], required: true },
  level: { type: Number, min: 1, max: 5, default: null },
  levelLabel: { type: String, default: null },
  stage: { type: String, enum: ["ramp", "vibration", "challenge"], default: null },
  rang: { type: Boolean, required: true },
  endedAt: { type: Date, default: null },
  verification: {
    required: { type: Boolean, required: true },
    passed: { type: Boolean, default: null },
    seconds: { type: Number, default: null },
    steps: { type: Number, default: null },
    score: { type: Number, default: null },
    threshold: { type: Number, default: null },
  },
}, { timestamps: { createdAt: true, updatedAt: false } });
WakeReportSchema.index({ userId: 1, alarmId: 1, ringAt: 1 }, { unique: true });
WakeReportSchema.index({ userId: 1, ringAt: -1 });
export const WakeReport = models.WakeReport || model<WakeReportDocument>("WakeReport", WakeReportSchema);

/**
 * The bedtime chosen in the wake planner for one night (prompt 3.4), so the
 * morning report can say whether it was kept. Cancelling the reminder cancels
 * the plan.
 */
export interface NightPlanDocument {
  userId: string;
  bedtime: Date;
  wakeAt: Date;
  cancelledAt?: Date;
  createdAt: Date;
}
const NightPlanSchema = new Schema<NightPlanDocument>({
  userId: { type: String, required: true, index: true },
  bedtime: { type: Date, required: true },
  wakeAt: { type: Date, required: true },
  cancelledAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false } });
export const NightPlan = models.NightPlan || model<NightPlanDocument>("NightPlan", NightPlanSchema);
