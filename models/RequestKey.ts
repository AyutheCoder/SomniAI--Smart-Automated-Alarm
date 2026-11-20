import { Schema, model, models } from "mongoose";

/**
 * A call the phone or page sent with an Idempotency-Key (prompt 7.3): its
 * outbox's id for the call, and the answer it got. If the connection drops
 * after the server did the work but before the answer arrived, the outbox
 * sends the call again; the stored answer is returned instead of doing it
 * twice. Kept 30 days, far past any outbox's retries.
 */
export interface RequestKeyDocument {
  userId: string;
  key: string;
  path: string;
  state: "pending" | "done";
  status?: number;
  body?: string;
  createdAt: Date;
}

const RequestKeySchema = new Schema<RequestKeyDocument>({
  userId: { type: String, required: true },
  key: { type: String, required: true },
  path: { type: String, required: true },
  state: { type: String, enum: ["pending", "done"], required: true },
  status: { type: Number },
  body: { type: String },
  createdAt: { type: Date, required: true },
});
RequestKeySchema.index({ userId: 1, key: 1 }, { unique: true });
RequestKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });

export const RequestKey = models.RequestKey || model<RequestKeyDocument>("RequestKey", RequestKeySchema);
