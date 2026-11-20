// The people alert check: run every minute by a scheduler through
// /api/cron/buddy-alerts. For everyone with a wake buddy (3.2) or an
// emergency contact (3.3): any of their alarms whose alert time has come, that
// the server hasn't heard them verify or stop, gets one alert to each person,
// within that person's rate limit: a push to the buddy, a text to the contact.
// lib/buddy.ts makes the decisions; this applies them and records each try.
//
// It runs on the server, so it works when the sleeper's phone is dead or
// offline, which is when it matters most.

import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, BuddyPair, PushToken, type AlertChannel } from "@/models/Buddy";
import { User } from "@/models/User";
import { resolveRingPlan } from "./ringPlan";
import {
  ALERT_AFTER_MAX,
  STALE_AFTER_MINUTES,
  alertText,
  alertVerdict,
  contactText,
  occurrenceKey,
  rateVerdict,
  sharedPhone,
  type AlertStatus,
  type BuddySettings,
  type PastAlert,
} from "./buddy";
import { publicName, settingsFor, type PairRecord } from "./buddyServer";
import type { PushSender } from "./push";
import { twilioFromEnv, type SmsSender } from "./sms";

/** A verify or stop this long before the ring's time still counts (a clock a little ahead). */
const AWAKE_SLACK_MS = 5 * 60_000;

export interface AlertRun {
  pairs: number;
  /** People with an emergency contact who agreed to be texted. */
  contacts: number;
  sent: number;
  attempts: { channel: AlertChannel; alarmId: string; status: AlertStatus; detail?: string }[];
  /** Why rings weren't alerted, counted: not_yet, awake, ordinary, too_soon, ... */
  skipped: Record<string, number>;
}

/** Who to tell about one sleeper. */
interface People {
  buddy?: { pairId: string; buddyId: string };
  contact?: { name: string; phone: string };
}

type Outcome = { status: AlertStatus; detail?: string; messageId?: string };

export async function runBuddyAlerts(push: PushSender, now: Date = new Date(), sms: SmsSender = twilioFromEnv()): Promise<AlertRun> {
  const run: AlertRun = { pairs: 0, contacts: 0, sent: 0, attempts: [], skipped: {} };
  const skip = (reason: string) => {
    run.skipped[reason] = (run.skipped[reason] ?? 0) + 1;
  };

  const sleepers = new Map<string, People>();
  const pairs = await BuddyPair.find({ status: "active" }).lean<PairRecord[]>();
  run.pairs = pairs.length;
  for (const pair of pairs) {
    const pairId = String(pair._id);
    for (const [sleeperId, buddyId] of [[pair.ownerId, pair.requesterId], [pair.requesterId, pair.ownerId]]) {
      sleepers.set(sleeperId, { ...sleepers.get(sleeperId), buddy: { pairId, buddyId } });
    }
  }
  // Only a contact the user said agreed to these texts.
  const withContact = await User.find({
    "preferences.emergencyContact.channel": "sms",
    "preferences.emergencyContact.value": { $exists: true, $ne: "" },
    "preferences.emergencyContact.consentAt": { $exists: true },
  }).select("preferences.emergencyContact").lean<{ _id: unknown; preferences: { emergencyContact: { name: string; value: string } } }[]>();
  run.contacts = withContact.length;
  for (const u of withContact) {
    const id = String(u._id);
    sleepers.set(id, { ...sleepers.get(id), contact: { name: u.preferences.emergencyContact.name, phone: u.preferences.emergencyContact.value } });
  }

  // Rings old enough to matter at the longest delay, and not yet stale.
  const earliest = new Date(now.getTime() - (ALERT_AFTER_MAX + STALE_AFTER_MINUTES) * 60_000);
  for (const [sleeperId, people] of sleepers) {
    const settings = await settingsFor(sleeperId);
    const alarms = await Alarm.find({
      userId: sleeperId,
      enabled: true,
      status: { $in: ["scheduled", "ringing", "snoozed"] },
      $or: [
        { snoozedFrom: { $gte: earliest, $lte: now } },
        { snoozedFrom: { $exists: false }, scheduledTime: { $gte: earliest, $lte: now } },
      ],
    }).lean<(AlarmDocument & { _id: unknown })[]>();

    for (const alarm of alarms) {
      const alarmId = String(alarm._id);
      const at = alarm.snoozedFrom ?? alarm.scheduledTime;
      // The alarm's own record says whether it's critical (lib/ringPlan.ts).
      const occurrence = { at, critical: resolveRingPlan(alarm).critical, enabled: alarm.enabled };
      const before = alertVerdict(occurrence, settings, false, now);
      if (!before.due) {
        skip(before.reason);
        continue;
      }
      const awake = await BehaviorEvent.exists({
        userId: sleeperId,
        type: { $in: ["verify_pass", "dismiss"] },
        "meta.alarmId": alarmId,
        at: { $gte: new Date(at.getTime() - AWAKE_SLACK_MS) },
      });
      const verdict = alertVerdict(occurrence, settings, Boolean(awake), now);
      if (!verdict.due) {
        skip(verdict.reason);
        continue;
      }
      const key = occurrenceKey(alarmId, at);
      const name = await publicName(sleeperId);
      const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);

      const channels: [AlertChannel, () => Promise<Outcome>, Record<string, unknown>][] = [];
      if (people.buddy) {
        const { pairId, buddyId } = people.buddy;
        channels.push(["buddy", () => pushToBuddy(push, buddyId, buddyData(name, alarm.label, at, minutes, settings)), { pairId, buddyId }]);
      }
      if (people.contact) {
        const phone = people.contact.phone;
        channels.push(["emergencyContact", () => textContact(sms, phone, contactText(name, alarm.label, minutes)), {}]);
      }
      for (const [channel, send, fields] of channels) {
        // Each person has their own limit: the buddy's alert doesn't hold back the contact's.
        const history = await BuddyAlert.find({
          sleeperId,
          channel: channel === "buddy" ? { $ne: "emergencyContact" } : "emergencyContact",
          $or: [{ occurrence: key }, { at: { $gte: new Date(now.getTime() - 24 * 3_600_000) } }],
        }).lean<PastAlert[]>();
        const rate = rateVerdict(history, key, now);
        if (!rate.allowed) {
          skip(`${channel}:${rate.reason}`);
          continue;
        }
        const out = await send();
        await BuddyAlert.create({ channel, sleeperId, alarmId, occurrence: key, ...out, ...fields, at: now });
        run.attempts.push({ channel, alarmId, status: out.status, detail: out.detail });
        if (out.status === "sent") {
          run.sent++;
        }
      }
    }
  }
  return run;
}

function buddyData(name: string, label: string, at: Date, minutes: number, settings: BuddySettings): Record<string, string> {
  const text = alertText(name, label, minutes);
  const phone = sharedPhone(settings);
  return {
    type: "buddy_alert",
    name,
    label,
    alarmAt: at.toISOString(),
    minutes: String(minutes),
    title: text.title,
    body: text.body,
    ...(phone ? { phone } : {}),
  };
}

/** To every phone the buddy has; tokens the push service says are gone are forgotten. */
async function pushToBuddy(sender: PushSender, buddyId: string, data: Record<string, string>): Promise<Outcome> {
  if (!sender.configured) {
    return { status: "not_configured", detail: "push is not configured on this server" };
  }
  const tokens = await PushToken.find({ userId: buddyId }).lean<{ token: string }[]>();
  if (tokens.length === 0) {
    return { status: "no_device", detail: "your buddy has no phone set up for alerts" };
  }
  const errors: string[] = [];
  const ids: string[] = [];
  for (const { token } of tokens) {
    const r = await sender.send(token, data);
    if (r.ok) {
      ids.push(r.messageId ?? "");
    }
    else {
      errors.push(r.error ?? "failed");
      if (r.unregistered) {
        await PushToken.deleteOne({ token });
      }
    }
  }
  if (ids.length > 0) {
    return { status: "sent", detail: `to ${ids.length} phone(s)`, messageId: ids.find(Boolean) };
  }
  return { status: "failed", detail: errors.join("; ") };
}

async function textContact(sms: SmsSender, phone: string, body: string): Promise<Outcome> {
  if (!sms.configured) {
    return { status: "not_configured", detail: "SMS is not configured on this server" };
  }
  const r = await sms.send(phone, body);
  return r.ok
    ? { status: "sent", detail: "text accepted by Twilio", messageId: r.messageId }
    : { status: "failed", detail: r.error ?? "failed" };
}
