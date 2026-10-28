// The backup level from a ringing page (prompt 3.3): asks the server, which
// has the transports (lib/backupServer.ts), and checks what comes back.
// Nothing here waits for the alarm: the page keeps ringing while this runs.
//
// The answer is checked, not trusted: a kind the server didn't answer for has
// failed, and "delivered" without a transport's receipt has failed too.

import { BACKUP_LABELS, BACKUP_STATUSES, delivered, type BackupKind, type BackupOutcome, type BackupResult } from "./backupAdapters";
import type { LaterAlert } from "./backupAdapters";


type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const postJson: Post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const failedAll = (kinds: readonly BackupKind[], reason: string): BackupResult => ({
  outcomes: kinds.map((kind) => ({ kind, label: BACKUP_LABELS[kind], status: "failed", reason })),
  later: [],
});

export async function requestBackupsFromServer(alarmId: string, kinds: readonly BackupKind[], post: Post = postJson): Promise<BackupResult> {
  let res;
  try {
    res = await post(`/api/alarms/${alarmId}/backups`, { kinds });
  }
  catch {
    return failedAll(kinds, "couldn't reach the server");
  }
  if (!res.ok) {
    return failedAll(kinds, `the server said ${res.status}`);
  }
  const data = ((await res.json().catch(() => ({}))) as { data?: { outcomes?: unknown; later?: unknown } }).data ?? {};
  const given = Array.isArray(data.outcomes) ? (data.outcomes as Partial<BackupOutcome>[]) : [];
  const later = Array.isArray(data.later)
    ? (data.later as LaterAlert[]).filter((l) => (l.who === "buddy" || l.who === "emergencyContact") && typeof l.name === "string" && !Number.isNaN(Date.parse(l.at)))
    : [];
  const laterKinds = new Set(later.map((l) => l.who));
  const outcomes: BackupOutcome[] = [];
  for (const kind of kinds) {
    if (kind === "emergencyContact" && laterKinds.has("emergencyContact")) {
      continue;
    }
    const o = given.find((x) => x.kind === kind);
    const label = BACKUP_LABELS[kind];
    if (!o || !o.status || !BACKUP_STATUSES.includes(o.status)) {
      outcomes.push({ kind, label, status: "failed", reason: "the server didn't answer for it" });
    }
    else if (o.status === "delivered") {
      outcomes.push(delivered(kind, (o as { receipt?: unknown }).receipt));
    }
    else {
      const reason = typeof (o as { reason?: unknown }).reason === "string" ? (o as { reason: string }).reason : "";
      outcomes.push({ kind, label, status: o.status, reason });
    }
  }
  return { outcomes, later };
}
