import { Schema, model, models } from "mongoose";
export interface ContextSnapshotDocument {
  userId: string;
  at: Date;
  weather?: {
    tempC: number;
    condition: string;
  };
  calendar?: {
    title: string;
    start: Date;
    importanceScore?: number;
  }[];
  wearable?: {
    restingHr?: number;
    steps?: number;
    lastSleepHours?: number;
  };
  source: "manual" | "simulated" | "live";
  createdAt: Date;
  updatedAt: Date;
}
const CalendarEntrySchema = new Schema({
  title: { type: String, required: true },
  start: { type: Date, required: true },
  importanceScore: { type: Number },
}, { _id: false });
const WeatherSchema = new Schema({ tempC: { type: Number }, condition: { type: String } }, { _id: false });
const WearableSchema = new Schema({
  restingHr: { type: Number },
  steps: { type: Number },
  lastSleepHours: { type: Number },
}, { _id: false });
const ContextSnapshotSchema = new Schema<ContextSnapshotDocument>({
  userId: { type: String, required: true, index: true },
  at: { type: Date, default: Date.now, index: true },
  weather: { type: WeatherSchema, default: undefined },
  calendar: { type: [CalendarEntrySchema], default: undefined },
  wearable: { type: WearableSchema, default: undefined },
  source: {
    type: String,
    enum: ["manual", "simulated", "live"],
    default: "simulated",
  },
}, { timestamps: true });
export const ContextSnapshot = models.ContextSnapshot ||
  model<ContextSnapshotDocument>("ContextSnapshot", ContextSnapshotSchema);