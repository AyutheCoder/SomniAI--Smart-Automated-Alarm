import { Schema, model, models } from "mongoose";
export type BehaviorEventType = "screen_on" | "screen_off" | "interaction" | "snooze" | "dismiss" |
  "verify_pass" | "verify_fail" | "alarm_fire" | "motion" | "ambient_noise" | "escalation";
export interface BehaviorEventDocument {
  userId: string;
  type: BehaviorEventType;
  value?: number;
  meta?: Record<string, unknown>;
  /** Events the routes record are live; the simulator's are not, and never reach a model. */
  source: "live" | "simulated";
  at: Date;
}
const BehaviorEventSchema = new Schema<BehaviorEventDocument>({
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  value: { type: Number },
  meta: { type: Schema.Types.Mixed },
  source: { type: String, enum: ["live", "simulated"], default: "live" },
  at: { type: Date, default: Date.now, index: true },
});
export const BehaviorEvent = models.BehaviorEvent ||
  model<BehaviorEventDocument>("BehaviorEvent", BehaviorEventSchema);