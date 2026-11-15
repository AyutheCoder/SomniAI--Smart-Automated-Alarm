import { Schema, model, models } from "mongoose";

/**
 * Uptime of the services the app depends on (prompt 7.3): today, the AI Brain.
 * One status document per service, updated by every check, and one outage
 * document per time it was down, with the alerts sent about it. No personal data.
 */
export type ServiceState = "up" | "down" | "not_configured";
export type AlertStatus = "delivered" | "failed" | "not_configured";

export interface ServiceStatusDocument {
  service: string;
  state: ServiceState;
  /** When it entered this state. */
  since: Date;
  checkedAt: Date;
  /** Failed checks in a row; it is called down after DOWN_AFTER of them (lib/uptime.ts). */
  failures: number;
  /** When the current run of failed checks began: an outage is dated from it. */
  failingSince?: Date | null;
  /** Why the last check failed, if it did. */
  reason?: string | null;
}

const ServiceStatusSchema = new Schema<ServiceStatusDocument>({
  service: { type: String, required: true, unique: true },
  state: { type: String, enum: ["up", "down", "not_configured"], required: true },
  since: { type: Date, required: true },
  checkedAt: { type: Date, required: true },
  failures: { type: Number, required: true, default: 0 },
  failingSince: { type: Date, default: null },
  reason: { type: String, default: null },
});

export const ServiceStatus = models.ServiceStatus || model<ServiceStatusDocument>("ServiceStatus", ServiceStatusSchema);

export interface OutageAlert {
  about: "down" | "up";
  status: AlertStatus;
  detail?: string;
  at: Date;
}

export interface OutageDocument {
  service: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string;
  alerts: OutageAlert[];
}

const OutageSchema = new Schema<OutageDocument>({
  service: { type: String, required: true, index: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  reason: { type: String, required: true },
  alerts: [{ _id: false, about: { type: String, enum: ["down", "up"] }, status: { type: String, enum: ["delivered", "failed", "not_configured"] }, detail: String, at: Date }],
});
// A year of history is plenty to see a pattern; older outages go.
OutageSchema.index({ startedAt: 1 }, { expireAfterSeconds: 365 * 86_400 });

export const Outage = models.Outage || model<OutageDocument>("Outage", OutageSchema);
