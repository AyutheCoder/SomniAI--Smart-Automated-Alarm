// The backup level, on the server (prompt 3.3): what a ringing device asks
// for when its ladder reaches backups (POST /api/alarms/[id]/backups).
//
// - Second device: rings now. Every other phone the user is signed in on gets a
//   push that starts it ringing; "delivered" carries Firebase's message id.
// - People (wake buddy, emergency contact): only after the sleeper's delay, and
//   only for alarms they're told about (lib/buddy.ts). The server's own check
//   (lib/buddyAlerts.ts) sends them, so they go even if this phone dies. Here
//   they're reported as they stand: delivered (with the stored receipt) if
//   already sent, not_configured if they won't be, or "later" with the time.
// - Smartwatch: there is no SomniAI watch app; never configured.
//
// Every outcome goes through dispatchBackups, which turns a "delivered"
// without a receipt into a failure.

import { BuddyAlert, PushToken } from "@/models/Buddy";
import type { AlarmDocument } from "@/models/Alarm";
import {
  BACKUP_LABELS,
  delivered,
  dispatchBackups,
  type BackupChannel,
  type BackupKind,
  type BackupOutcome,
  type BackupResult,
  type LaterAlert,
} from "./backupAdapters";
import { alertVerdict, clampAlertAfter, occurrenceKey } from "./buddy";
import { activePairFor, contactFor, otherSide, publicName, settingsFor } from "./buddyServer";
import type { PushSender } from "./push";
import { resolveRingPlan } from "./ringPlan";
import type { SmsSender } from "./sms";

export type BackupAnswer = BackupResult;

export const WATCH_REASON = "SomniAI has no watch app; a watch paired with your phone already shows its alarm notification";

const notConfigured = (kind: BackupKind, reason: string): BackupOutcome => ({ kind, label: BACKUP_LABELS[kind], status: "not_configured", reason });

/** Rings the user's other devices now. */
function secondDevice(userId: string, alarmId: string, label: string, fromToken: string | undefined, push: PushSender): BackupChannel {
  return {
    kind: "secondaryAlarm",
    async deliver() {
      const tokens = await PushToken.find({ userId, ...(fromToken ? { token: { $ne: fromToken } } : {}) }).lean<{ token: string }[]>();
      if (tokens.length === 0) {
        return notConfigured("secondaryAlarm", "No other device of yours has SomniAI open and signed in");
      }
      if (!push.configured) {
        return notConfigured("secondaryAlarm", "Push isn't set up on this server");
      }
      const errors: string[] = [];
      let receipt: string | undefined;
      for (const { token } of tokens) {
        const r = await push.send(token, { type: "backup_ring", alarmId, label });
        if (r.ok && r.messageId) {
          receipt ??= r.messageId;
        }
        else {
          errors.push(r.error ?? "failed");
          if (r.unregistered) {
            await PushToken.deleteOne({ token });
          }
        }
      }
      if (receipt) {
        return delivered("secondaryAlarm", { transport: "fcm", messageId: receipt, at: new Date().toISOString() });
      }
      return { kind: "secondaryAlarm", label: BACKUP_LABELS.secondaryAlarm, status: "failed", reason: errors.join("; ") };
    },
  };
}

export async function requestBackups(
  userId: string,
  alarm: AlarmDocument & { _id: unknown },
  kinds: BackupKind[],
  fromToken: string | undefined,
  push: PushSender,
  sms: SmsSender,
  now: Date = new Date(),
): Promise<BackupAnswer> {
  const alarmId = String(alarm._id);
  const ringAt = alarm.snoozedFrom ?? alarm.scheduledTime;
  const settings = await settingsFor(userId);
  const verdict = alertVerdict({ at: ringAt, critical: resolveRingPlan(alarm).critical, enabled: true }, settings, false, now);
  const toldAt = new Date(ringAt.getTime() + clampAlertAfter(settings.alertAfterMinutes) * 60_000).toISOString();
  const key = occurrenceKey(alarmId, ringAt);
  const later: LaterAlert[] = [];

  // People are told only for alarms they're told about, and not before the delay.
  const eligible = verdict.due || verdict.reason === "not_yet";
  const sent = async (channel: "buddy" | "emergencyContact") =>
    BuddyAlert.findOne({ sleeperId: userId, occurrence: key, status: "sent", channel: channel === "buddy" ? { $ne: "emergencyContact" } : "emergencyContact" })
      .lean<{ messageId?: string; at: Date }>();

  const pair = await activePairFor(userId);
  if (pair && eligible && !(await sent("buddy"))) {
    later.push({ who: "buddy", name: await publicName(otherSide(pair, userId)), at: toldAt });
  }

  const channels: Partial<Record<BackupKind, BackupChannel>> = {
    secondaryAlarm: secondDevice(userId, alarmId, alarm.label, fromToken, push),
    smartwatch: { kind: "smartwatch", deliver: async () => notConfigured("smartwatch", WATCH_REASON) },
  };
  const attempt = [...kinds];
  if (kinds.includes("emergencyContact")) {
    const contact = await contactFor(userId);
    const done = contact ? await sent("emergencyContact") : null;
    if (!contact) {
      channels.emergencyContact = { kind: "emergencyContact", deliver: async () => notConfigured("emergencyContact", "No emergency contact is set") };
    }
    else if (!sms.configured) {
      channels.emergencyContact = { kind: "emergencyContact", deliver: async () => notConfigured("emergencyContact", "SMS isn't set up on this server") };
    }
    else if (done) {
      channels.emergencyContact = {
        kind: "emergencyContact",
        deliver: async () => delivered("emergencyContact", { transport: "twilio", messageId: done.messageId ?? "", at: done.at.toISOString() }),
      };
    }
    else if (!eligible) {
      channels.emergencyContact = {
        kind: "emergencyContact",
        deliver: async () => notConfigured("emergencyContact", "Your emergency contact is told only about critical alarms (or ordinary ones, if you turn that on)"),
      };
    }
    else {
      // Not yet: the server's check texts them at the time below if it's still unanswered.
      attempt.splice(attempt.indexOf("emergencyContact"), 1);
      later.push({ who: "emergencyContact", name: contact.name, at: toldAt });
    }
  }
  return { outcomes: await dispatchBackups(attempt, { alarmLabel: alarm.label, text: "" }, channels), later };
}

/** Stops the backup ring on the user's other devices, once this one was stopped. */
export async function stopBackups(userId: string, alarmId: string, fromToken: string | undefined, push: PushSender): Promise<{ sent: number; failed: number }> {
  if (!push.configured) {
    return { sent: 0, failed: 0 };
  }
  const tokens = await PushToken.find({ userId, ...(fromToken ? { token: { $ne: fromToken } } : {}) }).lean<{ token: string }[]>();
  let sent = 0;
  let failed = 0;
  for (const { token } of tokens) {
    const r = await push.send(token, { type: "backup_stop", alarmId });
    if (r.ok) {
      sent++;
    }
    else {
      failed++;
    }
  }
  return { sent, failed };
}
