import { Schema, model, models } from "mongoose";

/**
 * Error tracking (prompt 7.3), in SomniAI's own database: one document per
 * kind of error, counted each time it happens again. Nothing in it says who
 * hit it: lib/errorTracking.ts removes email addresses, ids, tokens and
 * numbers before anything is stored, and no account is recorded.
 */
export type ErrorSource = "server" | "browser" | "ai-brain";

export interface ErrorEventDocument {
  /** Same source, kind, message shape, place and top stack frame: the same error. */
  fingerprint: string;
  source: ErrorSource;
  /** The error's type, e.g. TypeError. */
  kind: string;
  message: string;
  stack?: string;
  /** The page path or API route, without its query. */
  where?: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  /** Forgotten 90 days after it last happened. */
  expiresAt: Date;
}

const ErrorEventSchema = new Schema<ErrorEventDocument>({
  fingerprint: { type: String, required: true, unique: true },
  source: { type: String, enum: ["server", "browser", "ai-brain"], required: true },
  kind: { type: String, required: true, maxlength: 100 },
  message: { type: String, required: true, maxlength: 500 },
  stack: { type: String, maxlength: 2000 },
  where: { type: String, maxlength: 200 },
  count: { type: Number, required: true, min: 1 },
  firstAt: { type: Date, required: true },
  lastAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
});
ErrorEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ErrorEvent = models.ErrorEvent || model<ErrorEventDocument>("ErrorEvent", ErrorEventSchema);
