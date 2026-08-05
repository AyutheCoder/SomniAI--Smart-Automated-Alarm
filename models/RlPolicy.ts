import { Schema, model, models } from "mongoose";
export interface RlPolicyDocument {
  userId: string;
  policy: Record<string, unknown>;
  summary?: Record<string, unknown>;
  updates: number;
  meanReward: number;
  createdAt: Date;
  updatedAt: Date;
}
const RlPolicySchema = new Schema<RlPolicyDocument>({
  userId: { type: String, required: true, unique: true, index: true },
  policy: { type: Schema.Types.Mixed, default: {} },
  summary: { type: Schema.Types.Mixed },
  updates: { type: Number, default: 0 },
  meanReward: { type: Number, default: 0 },
}, { timestamps: true });
export const RlPolicy = models.RlPolicy || model<RlPolicyDocument>("RlPolicy", RlPolicySchema);