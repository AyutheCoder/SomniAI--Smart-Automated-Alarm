import { Schema, model, models } from "mongoose";
export type FeedbackOutcome = "success" | "snooze" | "missed";
export interface ModelFeedbackDocument {
  userId: string;
  alarmId?: string;
  context: Record<string, unknown>;
  action: Record<string, unknown>;
  outcome: FeedbackOutcome;
  reward: number;
  source: "ai" | "fallback";
  at: Date;
}
const ModelFeedbackSchema = new Schema<ModelFeedbackDocument>({
  userId: { type: String, required: true, index: true },
  alarmId: { type: String },
  context: { type: Schema.Types.Mixed, default: {} },
  action: { type: Schema.Types.Mixed, default: {} },
  outcome: {
    type: String,
    enum: ["success", "snooze", "missed"],
    required: true,
  },
  reward: { type: Number, required: true },
  source: { type: String, enum: ["ai", "fallback"], default: "fallback" },
  at: { type: Date, default: Date.now, index: true },
});
export const ModelFeedback = models.ModelFeedback ||
  model<ModelFeedbackDocument>("ModelFeedback", ModelFeedbackSchema);