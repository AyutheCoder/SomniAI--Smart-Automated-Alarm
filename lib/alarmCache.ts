// The alarm list as last known on this device.
//
// A reload while the server or database is down would otherwise leave the
// page with no alarms at all, so nothing would ring. The list is saved after
// every change and used when the server can't be reached.

import type { KeyValueStore } from "./outbox";
import type { Alarm } from "./types";

const keyFor = (userId: string) => `somniai.alarms.v1:${userId}`;

export function saveAlarmCache(store: KeyValueStore | null, userId: string, alarms: Alarm[]) {
  try {
    store?.setItem(keyFor(userId), JSON.stringify(alarms));
  }
  catch {
    // Storage full or blocked: the in-page list still works.
  }
}

export function loadAlarmCache(store: KeyValueStore | null, userId: string): Alarm[] | null {
  try {
    const raw = store?.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Alarm[]) : null;
  }
  catch {
    return null;
  }
}

/**
 * The server's list, except for alarms with changes still waiting in the
 * outbox: for those the device's copy is newer, and the stale server copy
 * (say, still "scheduled" at a time already dismissed here) must not win.
 */
export function mergeWithLocal(server: Alarm[], local: Alarm[] | null, pendingIds: Set<string>): Alarm[] {
  if (!local || pendingIds.size === 0) {
    return server;
  }
  const localById = new Map(local.map((a) => [a._id, a]));
  return server.map((a) => (pendingIds.has(a._id) ? localById.get(a._id) ?? a : a));
}
