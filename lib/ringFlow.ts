// What happens to an alarm when its ring ends, worked out in the browser.
//
// A snooze or a dismissal takes effect here, on the device, the moment the
// person acts: a snoozed alarm is armed again, and a repeating alarm moves to
// its next occurrence, with no server involved. The server only hears about it
// afterwards, through the calls listed by syncCalls, sent by the outbox once
// the ring is over. Before this, a snooze waited on the server's reply, so with
// the database down a snoozed alarm never rang again.

import type { OutboxCall } from "./outbox";
import { nextOccurrence } from "./recurrence";
import type { Alarm } from "./types";

export const SNOOZE_MINUTES = 5;

export function snoozeLocally(alarm: Alarm, now: Date, minutes = SNOOZE_MINUTES): Alarm {
  return {
    ...alarm,
    snoozedFrom: alarm.snoozedFrom ?? alarm.scheduledTime,
    scheduledTime: new Date(now.getTime() + minutes * 60_000).toISOString(),
    status: "scheduled",
    lastSnoozeCount: (alarm.lastSnoozeCount ?? 0) + 1,
  };
}

/**
 * A repeating alarm moves to its next occurrence; a one-off is done. It reads
 * "dismissed" until the server, which scores the wake check, says "verified".
 */
export function dismissLocally(alarm: Alarm, now: Date): Alarm {
  const next = nextOccurrence(new Date(alarm.snoozedFrom ?? alarm.scheduledTime), alarm.repeat, now);
  const { snoozedFrom: _drop, ...rest } = alarm;
  void _drop;
  if (next) {
    return { ...rest, scheduledTime: next.toISOString(), status: "scheduled", enabled: true, lastSnoozeCount: 0 };
  }
  return { ...rest, status: "dismissed", enabled: false };
}

export interface RingOutcome {
  snoozed: boolean;
  /** When snoozed: the time the alarm was set to ring again, from snoozeLocally. */
  snoozedUntil?: string;
  /** From the start of the ring to its end: what dismiss and snooze report. */
  responseMs: number;
  /**
   * Time spent on the challenges, which is what the wake model's speed
   * brackets (6 to 45 s) describe and what verify reports. The phone reports
   * the same (Verification.java), so a wake scores the same from either.
   */
  timeOnTaskMs: number;
  challenged: boolean;
  methods: string[];
  attempts: number;
  motion?: number;
  solved: boolean;
  correctness: number;
  escalationLevel: number;
  backups: { kind: string; status: string }[];
}

/** The server calls that record one ring, in the order they must arrive. */
export function syncCalls(alarmId: string, outcome: RingOutcome): OutboxCall[] {
  const base = `/api/alarms/${alarmId}`;
  const calls: OutboxCall[] = [{ alarmId, method: "POST", path: `${base}/fire` }];
  if (outcome.snoozed) {
    calls.push({
      alarmId,
      method: "POST",
      path: `${base}/snooze`,
      body: { snoozeMinutes: SNOOZE_MINUTES, until: outcome.snoozedUntil, responseMs: outcome.responseMs },
    });
    return calls;
  }
  if (outcome.challenged) {
    calls.push({
      alarmId,
      method: "POST",
      path: `${base}/verify`,
      // The server scores from these; it does not take a client score.
      body: {
        methods: outcome.methods,
        responseMs: outcome.timeOnTaskMs,
        attempts: outcome.attempts,
        motion: outcome.motion,
        solved: outcome.solved,
        correctness: outcome.correctness,
      },
    });
  }
  // Every dismissed ring reports the level it had reached: that is how hard this
  // wake was, which is what the personal ladder is learnt from
  // (ringPlanServer.ts reads these). It used to be sent only from level 5, so
  // the profile only ever saw the hardest mornings.
  calls.push({
    alarmId,
    method: "POST",
    path: `${base}/escalate`,
    // What each backup channel actually did, not the list it was asked to try.
    body: { level: outcome.escalationLevel, backups: outcome.backups },
  });
  // The server decides "verified" from its own verify record.
  calls.push({ alarmId, method: "POST", path: `${base}/dismiss`, body: { responseMs: outcome.responseMs } });
  return calls;
}
