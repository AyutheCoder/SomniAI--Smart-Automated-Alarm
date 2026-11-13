import { Schema, model, models } from "mongoose";

/**
 * A user's Google Calendar, connected read-only (prompt 4.1). The refresh
 * token is stored sealed (lib/secretBox.ts); the access token isn't kept, a
 * fresh one is asked for on each sync. "revoked": Google said the grant is
 * gone, so the user has to connect again.
 */
export type CalendarStatus = "connected" | "revoked";
export interface CalendarConnectionDocument {
  userId: string;
  provider: "google";
  /** The Google account connected, for the panel. */
  email: string | null;
  refreshTokenSealed: string;
  scopes: string[];
  status: CalendarStatus;
  connectedAt: Date;
  lastSyncAt?: Date;
  lastSync?: { events: number; added: number; updated: number; removed: number };
  /** Why the last sync didn't happen, in words. */
  lastError?: string | null;
}
const CalendarConnectionSchema = new Schema<CalendarConnectionDocument>({
  userId: { type: String, required: true, unique: true },
  provider: { type: String, enum: ["google"], default: "google" },
  email: { type: String, default: null },
  refreshTokenSealed: { type: String, required: true },
  scopes: { type: [String], default: [] },
  status: { type: String, enum: ["connected", "revoked"], required: true },
  connectedAt: { type: Date, required: true },
  lastSyncAt: { type: Date },
  lastSync: {
    events: Number,
    added: Number,
    updated: Number,
    removed: Number,
  },
  lastError: { type: String, default: null },
});
export const CalendarConnection = models.CalendarConnection
  || model<CalendarConnectionDocument>("CalendarConnection", CalendarConnectionSchema);
