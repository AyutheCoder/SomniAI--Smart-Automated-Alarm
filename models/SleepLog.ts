import { Schema, model, models } from "mongoose";
export interface SleepLogDocument {
  userId: string;
  date: string;
  sleepTime?: Date;
  wakeTime?: Date;
  durationHours?: number;
  snoozeCount?: number;
  alarmResponseMs?: number;
  wakeConfidence?: number;
  qualityScore?: number;
  /** Resting heart rate on the wake date, beats per minute (Health Connect, prompt 4.2). */
  restingHr?: number;
  /** Time in bed, when it differs from time asleep (a session with sleep stages). */
  inBedHours?: number;
  /** Whether time asleep came from recorded sleep stages, or is the session's length. */
  stagesRecorded?: boolean;
  /** How many sessions ended on this date; the longest was kept (prompt 4.2). */
  sessions?: number;
  /** The Health Connect session kept, and the app that recorded it. */
  externalId?: string;
  origin?: string;
  /** "simulated" nights never reach a model; the others are real. */
  source: "manual" | "sensor" | "wearable" | "health_connect" | "simulated";
  createdAt: Date;
  updatedAt: Date;
}
const SleepLogSchema = new Schema<SleepLogDocument>({
  userId: { type: String, required: true, index: true },
  date: { type: String, required: true },
  sleepTime: { type: Date },
  wakeTime: { type: Date },
  durationHours: { type: Number },
  snoozeCount: { type: Number, default: 0 },
  alarmResponseMs: { type: Number },
  wakeConfidence: { type: Number },
  qualityScore: { type: Number },
  restingHr: { type: Number, min: 20, max: 250 },
  inBedHours: { type: Number },
  stagesRecorded: { type: Boolean },
  sessions: { type: Number },
  externalId: { type: String },
  origin: { type: String },
  source: {
    type: String,
    enum: ["manual", "sensor", "wearable", "health_connect", "simulated"],
    default: "manual",
  },
}, { timestamps: true });
SleepLogSchema.index({ userId: 1, date: 1 }, { unique: true });
export const SleepLog = models.SleepLog || model<SleepLogDocument>("SleepLog", SleepLogSchema);