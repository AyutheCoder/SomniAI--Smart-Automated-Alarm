import { Schema, model, models } from "mongoose";

/**
 * A user's consent to alarm telemetry (prompt 5.1): given or not, which
 * version of the text they agreed to, and every change, which an export
 * includes. Nothing is stored without it (lib/telemetry.ts).
 */
export interface TelemetryConsentDocument {
  userId: string;
  granted: boolean;
  version: string | null;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  /** When the user last deleted their telemetry: nothing from before it is stored again. */
  deletedAt: Date | null;
  history: { granted: boolean; version: string | null; at: Date }[];
}

const TelemetryConsentSchema = new Schema<TelemetryConsentDocument>({
  userId: { type: String, required: true, unique: true },
  granted: { type: Boolean, required: true, default: false },
  version: { type: String, default: null },
  grantedAt: { type: Date, default: null },
  withdrawnAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  history: [{ _id: false, granted: Boolean, version: { type: String, default: null }, at: Date }],
});

export const TelemetryConsent = models.TelemetryConsent || model<TelemetryConsentDocument>("TelemetryConsent", TelemetryConsentSchema);
