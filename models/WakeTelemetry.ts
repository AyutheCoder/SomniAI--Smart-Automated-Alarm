import { Schema, model, models } from "mongoose";

/**
 * One wake as the phone recorded it, with consent (prompt 5.1): every ring of
 * one occurrence of an alarm, snoozes included. Timings and outcomes only.
 * One per user, alarm and occurrence, so a resent wake changes nothing.
 */
export interface WakeTelemetryRing {
  at: Date;
  firstInteractionMs: number | null;
  via: "screen" | "key" | "notification" | null;
  durationMs: number;
  level: number;
  stage: string | null;
  outcome: "dismissed" | "snoozed" | "unanswered" | "interrupted";
}

export interface WakeTelemetryDocument {
  userId: string;
  alarmId: string;
  scheduledFor: Date;
  consentVersion: string;
  firstRingAt: Date;
  endedAt: Date;
  outcome: "dismissed" | "unanswered";
  snoozes: number;
  firstInteractionMs: number | null;
  stageReached: { level: number; stage: string | null };
  verification: {
    required: boolean;
    result: "passed" | "not_required" | "not_passed";
    attempts?: number;
    steps?: number;
    timeOnTaskMs?: number;
    correctness?: number;
    methods?: string[];
  };
  rings: WakeTelemetryRing[];
  receivedAt: Date;
}

const RingSchema = new Schema<WakeTelemetryRing>({
  at: { type: Date, required: true },
  firstInteractionMs: { type: Number, default: null, min: 0 },
  via: { type: String, enum: ["screen", "key", "notification", null], default: null },
  durationMs: { type: Number, required: true, min: 0 },
  level: { type: Number, required: true, min: 0, max: 10 },
  stage: { type: String, default: null },
  outcome: { type: String, enum: ["dismissed", "snoozed", "unanswered", "interrupted"], required: true },
}, { _id: false });

const WakeTelemetrySchema = new Schema<WakeTelemetryDocument>({
  userId: { type: String, required: true },
  alarmId: { type: String, required: true },
  scheduledFor: { type: Date, required: true },
  consentVersion: { type: String, required: true },
  firstRingAt: { type: Date, required: true },
  endedAt: { type: Date, required: true },
  outcome: { type: String, enum: ["dismissed", "unanswered"], required: true },
  snoozes: { type: Number, required: true, min: 0 },
  firstInteractionMs: { type: Number, default: null, min: 0 },
  stageReached: { level: Number, stage: { type: String, default: null } },
  verification: {
    required: Boolean,
    result: { type: String, enum: ["passed", "not_required", "not_passed"] },
    attempts: Number,
    steps: Number,
    timeOnTaskMs: Number,
    correctness: Number,
    methods: { type: [String], default: undefined },
  },
  rings: { type: [RingSchema], default: [] },
  receivedAt: { type: Date, required: true },
});
WakeTelemetrySchema.index({ userId: 1, alarmId: 1, scheduledFor: 1 }, { unique: true });

export const WakeTelemetry = models.WakeTelemetry || model<WakeTelemetryDocument>("WakeTelemetry", WakeTelemetrySchema);
