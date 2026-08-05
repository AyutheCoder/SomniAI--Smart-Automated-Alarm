import { Schema, model, models } from "mongoose";
export type WakeStrategy = "gentle" | "adaptive" | "aggressive";
export interface AlarmDecision {
  summary: string;
  rationale: string;
  attributions: {
    feature: string;
    value: string;
    impact: "increase" | "decrease" | "neutral";
    weight: number;
    detail?: string;
  }[];
  confidence?: number;
  decidedBy?: "scheduler" | "rl" | "lifecycle" | "user";
  at?: Date;
}
export type AlarmStatus = "scheduled" | "ringing" | "snoozed" | "dismissed" | "verified" | "missed" | "completed";
export interface AlarmDocument {
  userId: string;
  label: string;
  scheduledTime: Date;
  source: "manual" | "assisted" | "autonomous";
  linkedTaskId?: string;
  repeat: {
    type: "none" | "daily" | "weekdays" | "custom";
    days?: number[];
  };
  intensity: number;
  wakeStrategy: WakeStrategy;
  verificationRequired: boolean;
  verificationMethod: "math" | "typing" | "tap" | "none";
  verificationMethods: string[];
  minConfidence: number;
  status: AlarmStatus;
  enabled: boolean;
  lastSnoozeCount: number;
  decision?: AlarmDecision;
  createdAt: Date;
  updatedAt: Date;
}
const AlarmSchema = new Schema<AlarmDocument>({
  userId: { type: String, required: true, index: true },
  label: { type: String, required: true, trim: true, maxlength: 200 },
  scheduledTime: { type: Date, required: true },
  source: {
    type: String,
    enum: ["manual", "assisted", "autonomous"],
    default: "manual",
  },
  linkedTaskId: { type: String },
  repeat: {
    type: { type: String, enum: ["none", "daily", "weekdays", "custom"], default: "none" },
    days: { type: [Number], default: undefined },
  },
  intensity: { type: Number, default: 60, min: 0, max: 100 },
  wakeStrategy: {
    type: String,
    enum: ["gentle", "adaptive", "aggressive"],
    default: "adaptive",
  },
  verificationRequired: { type: Boolean, default: true },
  verificationMethod: {
    type: String,
    enum: ["math", "typing", "tap", "none"],
    default: "math",
  },
  verificationMethods: { type: [String], default: ["math"] },
  minConfidence: { type: Number, default: 70, min: 0, max: 100 },
  status: {
    type: String,
    enum: [
      "scheduled",
      "ringing",
      "snoozed",
      "dismissed",
      "verified",
      "missed",
      "completed",
    ],
    default: "scheduled",
    index: true,
  },
  enabled: { type: Boolean, default: true },
  lastSnoozeCount: { type: Number, default: 0 },
  decision: { type: Schema.Types.Mixed, default: undefined },
}, { timestamps: true });
export const Alarm = models.Alarm || model<AlarmDocument>("Alarm", AlarmSchema);