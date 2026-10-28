// The wake-buddy alert check: run every minute by a scheduler through
// /api/cron/buddy-alerts. For each active pair, both ways: any of the
// sleeper's alarms whose alert time has come, that the server hasn't heard
// them verify or stop, gets one push to the buddy, within the rate limit.
// lib/buddy.ts makes the decisions; this applies them and records each try.

import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, BuddyPair, PushToken } from "@/models/Buddy";
import { resolveRingPlan } from "./ringPlan";
import {
  ALERT_AFTER_MAX,
  STALE_AFTER_MINUTES,
  alertText,
  alertVerdict,
  occurrenceKey,
  rateVerdict,
  sharedPhone,
  type AlertStatus,
  type PastAlert,
} from "./buddy";
import { publicName, settingsFor, type PairRecord } from "./buddyServer";
import type { PushSender } from "./push";

/** A verify or stop this long before the ring's time still counts (a clock a little ahead). */
const AWAKE_SLACK_MS = 5 * 60_000;

export interface AlertRun {
  pairs: number;
  sent: number;
  attempts: { pairId: string; alarmId: string; status: AlertStatus; detail?: string }[];
  /** Why rings weren't alerted, counted: not_yet, awake, ordinary, too_soon, ... */
  skipped: Record<string, number>;
}

export async function runBuddyAlerts(sender: PushSender, now: Date = new Date()): Promise<AlertRun> {
  const run: AlertRun = { pairs: 0, sent: 0, attempts: [], skipped: {} };
  const skip = (reason: string) => {
    run.skipped[reason] = (run.skipped[reason] ?? 0) + 1;
  };
  const pairs = await BuddyPair.find({ status: "active" }).lean<PairRecord[]>();
  run.pairs = pairs.length;
  // Rings old enough to matter at the longest delay, and not yet stale.
  const earliest = new Date(now.getTime() - (ALERT_AFTER_MAX + STALE_AFTER_MINUTES) * 60_000);

  for (const pair of pairs) {
    const pairId = String(pair._id);
    for (const [sleeperId, buddyId] of [[pair.ownerId, pair.requesterId], [pair.requesterId, pair.ownerId]]) {
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
        const critical = resolveRingPlan(alarm).critical;
        const occurrence = { at, critical, enabled: alarm.enabled };
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
        const history = await BuddyAlert.find({
          pairId,
          sleeperId,
          $or: [{ occurrence: key }, { at: { $gte: new Date(now.getTime() - 24 * 3_600_000) } }],
        }).lean<PastAlert[]>();
        const rate = rateVerdict(history, key, now);
        if (!rate.allowed) {
          skip(rate.reason);
          continue;
        }

        const name = await publicName(sleeperId);
        const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
        const text = alertText(name, alarm.label, minutes);
        const phone = sharedPhone(settings);
        const data: Record<string, string> = {
          type: "buddy_alert",
          name,
          label: alarm.label,
          alarmAt: at.toISOString(),
          minutes: String(minutes),
          title: text.title,
          body: text.body,
          ...(phone ? { phone } : {}),
        };
        const { status, detail } = await deliver(sender, buddyId, data);
        await BuddyAlert.create({ pairId, sleeperId, buddyId, alarmId, occurrence: key, status, detail, at: now });
        run.attempts.push({ pairId, alarmId, status, detail });
        if (status === "sent") {
          run.sent++;
        }
      }
    }
  }
  return run;
}

/** To every phone the buddy has; tokens the push service says are gone are forgotten. */
async function deliver(sender: PushSender, buddyId: string, data: Record<string, string>): Promise<{ status: AlertStatus; detail?: string }> {
  if (!sender.configured) {
    return { status: "not_configured", detail: "push is not configured on this server" };
  }
  const tokens = await PushToken.find({ userId: buddyId }).lean<{ token: string }[]>();
  if (tokens.length === 0) {
    return { status: "no_device", detail: "your buddy has no phone set up for alerts" };
  }
  const errors: string[] = [];
  let delivered = 0;
  for (const { token } of tokens) {
    const r = await sender.send(token, data);
    if (r.ok) {
      delivered++;
    }
    else {
      errors.push(r.error ?? "failed");
      if (r.unregistered) {
        await PushToken.deleteOne({ token });
      }
    }
  }
  if (delivered > 0) {
    return { status: "sent", detail: `to ${delivered} phone(s)` };
  }
  return { status: "failed", detail: errors.join("; ") };
}
