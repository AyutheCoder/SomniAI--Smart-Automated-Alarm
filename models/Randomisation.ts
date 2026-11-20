import { Schema, model, models } from "mongoose";
import type { Arm, Experiment } from "@/lib/randomisation";

/**
 * A user's randomisation (prompt 6.1): which experiment runs, from which seed,
 * and how many alarms it has randomised (the next sequence number, taken
 * atomically). One active at a time; starting another stops the last.
 */
export interface RandomisationDocument {
  userId: string;
  experiment: Experiment;
  seed: string;
  active: boolean;
  next: number;
  startedAt: Date;
  stoppedAt: Date | null;
}

const RandomisationSchema = new Schema<RandomisationDocument>({
  userId: { type: String, required: true, index: true },
  experiment: { type: String, enum: ["escalation_pacing", "wake_plan"], required: true },
  seed: { type: String, required: true },
  active: { type: Boolean, required: true },
  next: { type: Number, required: true, default: 0, min: 0 },
  startedAt: { type: Date, required: true },
  stoppedAt: { type: Date, default: null },
});
// At most one active randomisation per user.
RandomisationSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { active: true } });

export const Randomisation = models.Randomisation || model<RandomisationDocument>("Randomisation", RandomisationSchema);

/**
 * The log: one entry per alarm per randomisation, never rewritten. An
 * unmissable alarm is logged as excluded, with no sequence number or arm.
 * `overriddenAt` marks an arm that stopped applying because the alarm later
 * became unmissable; the arm itself stays as drawn.
 */
export interface AssignmentDocument {
  userId: string;
  alarmId: string;
  experiment: Experiment;
  seed: string;
  sequence: number | null;
  block: number | null;
  arm: Arm | null;
  excluded: "unmissable" | null;
  overriddenAt: Date | null;
  assignedAt: Date;
}

const AssignmentSchema = new Schema<AssignmentDocument>({
  userId: { type: String, required: true, index: true },
  alarmId: { type: String, required: true },
  experiment: { type: String, enum: ["escalation_pacing", "wake_plan"], required: true },
  seed: { type: String, required: true },
  sequence: { type: Number, default: null },
  block: { type: Number, default: null },
  arm: { type: String, enum: ["standard", "stretched", "shown", "not_shown", null], default: null },
  excluded: { type: String, enum: ["unmissable", null], default: null },
  overriddenAt: { type: Date, default: null },
  assignedAt: { type: Date, required: true },
});
AssignmentSchema.index({ alarmId: 1, experiment: 1, seed: 1 }, { unique: true });
AssignmentSchema.index({ userId: 1, experiment: 1, seed: 1, sequence: 1 }, { unique: true, partialFilterExpression: { sequence: { $type: "number" } } });

export const Assignment = models.Assignment || model<AssignmentDocument>("Assignment", AssignmentSchema);
