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
  source: "manual" | "sensor" | "wearable";
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
  source: {
    type: String,
    enum: ["manual", "sensor", "wearable"],
    default: "manual",
  },
}, { timestamps: true });
SleepLogSchema.index({ userId: 1, date: 1 }, { unique: true });
export const SleepLog = models.SleepLog || model<SleepLogDocument>("SleepLog", SleepLogSchema);