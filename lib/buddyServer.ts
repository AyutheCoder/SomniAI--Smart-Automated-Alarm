// The wake buddy's database side, shared by the /api/buddy routes and the
// alert check (lib/buddyAlerts.ts). The decisions are in lib/buddy.ts.

import { BuddyPair, type BuddyPairDocument } from "@/models/Buddy";
import { User } from "@/models/User";
import { DEFAULT_SETTINGS, clampAlertAfter, type BuddySettings } from "./buddy";

export type PairRecord = BuddyPairDocument & { _id: unknown };

/** The user's one active pairing, if any. */
export async function activePairFor(userId: string): Promise<PairRecord | null> {
  return BuddyPair.findOne({ status: "active", $or: [{ ownerId: userId }, { requesterId: userId }] }).lean<PairRecord>();
}

export function otherSide(pair: Pick<BuddyPairDocument, "ownerId" | "requesterId">, userId: string): string {
  return pair.ownerId === userId ? pair.requesterId : pair.ownerId;
}

/**
 * What a buddy sees of a user: their name, never their e-mail address. A
 * user without a name is "Your buddy".
 */
export async function publicName(userId: string): Promise<string> {
  const u = await User.findById(userId).select("name").lean<{ name?: string }>();
  const name = u?.name?.trim();
  return name ? name : "Your buddy";
}

export async function settingsFor(userId: string): Promise<BuddySettings> {
  const u = await User.findById(userId).select("preferences.buddy").lean<{ preferences?: { buddy?: Partial<BuddySettings> } }>();
  const b = u?.preferences?.buddy ?? {};
  return {
    alertAfterMinutes: clampAlertAfter(b.alertAfterMinutes ?? DEFAULT_SETTINGS.alertAfterMinutes),
    ordinaryAlarms: b.ordinaryAlarms === true,
    phone: b.phone ?? null,
    sharePhone: b.sharePhone === true,
  };
}
