import { Schema, model, models } from "mongoose";
import type { AlertStatus } from "@/lib/buddy";

/**
 * A pairing between two users (prompt 3.2). The owner shared an invite code;
 * the requester asked to pair with it (their consent); the owner accepted
 * (theirs). Either can end it. Ended and declined pairings are kept, so
 * nobody is alerted through one again.
 */
export type BuddyStatus = "requested" | "active" | "declined" | "ended";
export interface BuddyPairDocument {
  ownerId: string;
  requesterId: string;
  status: BuddyStatus;
  requestedAt: Date;
  acceptedAt?: Date;
  /** When it was declined, cancelled or unpaired, and by whom. */
  closedAt?: Date;
  closedBy?: string;
}
const BuddyPairSchema = new Schema<BuddyPairDocument>({
  ownerId: { type: String, required: true, index: true },
  requesterId: { type: String, required: true, index: true },
  status: { type: String, enum: ["requested", "active", "declined", "ended"], required: true, index: true },
  requestedAt: { type: Date, required: true },
  acceptedAt: { type: Date },
  closedAt: { type: Date },
  closedBy: { type: String },
});
export const BuddyPair = models.BuddyPair || model<BuddyPairDocument>("BuddyPair", BuddyPairSchema);

/** One open invite per user: a code to share, valid for a day. */
export interface BuddyInviteDocument {
  userId: string;
  code: string;
  expiresAt: Date;
}
const BuddyInviteSchema = new Schema<BuddyInviteDocument>({
  userId: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});
export const BuddyInvite = models.BuddyInvite || model<BuddyInviteDocument>("BuddyInvite", BuddyInviteSchema);

/** Where a user's buddy alerts go: their phones' push tokens. */
export interface PushTokenDocument {
  userId: string;
  token: string;
  platform: "android";
  updatedAt: Date;
}
const PushTokenSchema = new Schema<PushTokenDocument>({
  userId: { type: String, required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["android"], default: "android" },
  updatedAt: { type: Date, required: true },
});
export const PushToken = models.PushToken || model<PushTokenDocument>("PushToken", PushTokenSchema);

/**
 * Every alert attempt to a person, sent or not: the rate limit reads it, and
 * the sleeper can see who was told when. The buddy by push (3.2), the
 * emergency contact by SMS (3.3).
 */
export type AlertChannel = "buddy" | "emergencyContact";
export interface BuddyAlertDocument {
  channel: AlertChannel;
  /** The pairing, for a buddy alert. */
  pairId?: string;
  sleeperId: string;
  buddyId?: string;
  alarmId: string;
  /** lib/buddy.ts occurrenceKey: which ring. */
  occurrence: string;
  status: AlertStatus;
  detail?: string;
  /** The transport's own id for it (Firebase message name, Twilio SID): the receipt. */
  messageId?: string;
  at: Date;
}
const BuddyAlertSchema = new Schema<BuddyAlertDocument>({
  // Records from before 3.3 have none: they were all buddy alerts.
  channel: { type: String, enum: ["buddy", "emergencyContact"], default: "buddy" },
  pairId: { type: String, index: true },
  sleeperId: { type: String, required: true, index: true },
  buddyId: { type: String },
  alarmId: { type: String, required: true },
  occurrence: { type: String, required: true },
  status: { type: String, enum: ["sent", "failed", "no_device", "not_configured"], required: true },
  detail: { type: String },
  messageId: { type: String },
  at: { type: Date, required: true, index: true },
});
export const BuddyAlert = models.BuddyAlert || model<BuddyAlertDocument>("BuddyAlert", BuddyAlertSchema);
