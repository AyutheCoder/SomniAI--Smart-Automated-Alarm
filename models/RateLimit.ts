import { Schema, model, models } from "mongoose";

/**
 * One rate-limit window's count (lib/rateLimit.ts): the id is
 * "policy|key|window". MongoDB's TTL monitor deletes it once expiresAt passes.
 */
export interface RateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

const RateLimitSchema = new Schema<RateLimitDocument>({
  _id: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
}, { _id: false, versionKey: false });
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = models.RateLimit || model<RateLimitDocument>("RateLimit", RateLimitSchema);
