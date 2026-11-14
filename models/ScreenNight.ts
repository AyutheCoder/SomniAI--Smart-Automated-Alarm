import { Schema, model, models } from "mongoose";

/**
 * Screen time before bed on one night (prompt 4.3), measured on the phone from
 * Android's usage records (ScreenNights.java): minutes of use in the window
 * before bed. Only the total: never which apps. One per user and wake date.
 */
export interface ScreenNightDocument {
  userId: string;
  /** The wake date, as the sleep log keys nights. */
  date: string;
  bedtime: Date;
  minutes: number;
  windowMinutes: number;
  /** Where bed came from: the sleep log, or the phone's own reading of it. */
  bedtimeFrom: "sleep_log" | "phone";
  updatedAt: Date;
}

const ScreenNightSchema = new Schema<ScreenNightDocument>({
  userId: { type: String, required: true },
  date: { type: String, required: true },
  bedtime: { type: Date, required: true },
  minutes: { type: Number, required: true, min: 0 },
  windowMinutes: { type: Number, required: true, min: 1, max: 720 },
  bedtimeFrom: { type: String, enum: ["sleep_log", "phone"], required: true },
}, { timestamps: { createdAt: false, updatedAt: true } });
ScreenNightSchema.index({ userId: 1, date: 1 }, { unique: true });

export const ScreenNight = models.ScreenNight || model<ScreenNightDocument>("ScreenNight", ScreenNightSchema);
