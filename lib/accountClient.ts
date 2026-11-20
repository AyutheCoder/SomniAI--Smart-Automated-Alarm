// Deleting the account from the page (prompt 7.2). The server goes first: if
// it refuses or can't be reached, nothing is cleared and the alarms on this
// phone keep ringing. Once it has deleted everything, this phone forgets its
// alarms, unsent calls and telemetry (AccountReset.java), and this browser its
// cached alarms, outbox and bedtime reminder. Other phones signed in to the
// account are refused by the server from then on (lib/session.ts) and keep
// only what is already on them, which the text says.

import type { SomniAlarmPlugin } from "./nativeAlarm";

/** The plugin version that can forget a deleted account. */
export const FORGET_API = 8;

type Phone = Partial<Pick<SomniAlarmPlugin, "reconcile" | "clearTelemetry">> & {
  forgetAccount?: () => Promise<{ alarms: number; unsent: number }>;
};

export interface DeleteRequest {
  confirm: string;
  password?: string;
}

export interface DeleteOutcome {
  ok: boolean;
  text: string;
}

type Del = (body: DeleteRequest) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;

const del: Del = async (body) => {
  const res = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: string } | null;
  return { ok: res.ok && json?.ok === true, status: res.status, data: json?.data, error: json?.error };
};

/** Every key this app keeps in the browser for `userId` (lib/alarmCache.ts, lib/outbox.ts, lib/bedtime.ts). */
export function browserKeysFor(storage: Pick<Storage, "length" | "key">, userId: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith("somniai.") && k.endsWith(`:${userId}`)) {
      out.push(k);
    }
  }
  return out;
}

export async function deleteMyAccount(
  body: DeleteRequest,
  ctx: { userId: string; phone: Phone | null; api: number; storage: Storage | null },
  send: Del = del,
): Promise<DeleteOutcome> {
  const res = await send(body);
  if (!res.ok) {
    return { ok: false, text: res.error ?? `Couldn't delete the account (the server said ${res.status}). Nothing was deleted.` };
  }
  const result = res.data as { calendarRevokedAtGoogle: boolean | null };

  let phone = "";
  if (ctx.phone) {
    try {
      if (ctx.api >= FORGET_API && ctx.phone.forgetAccount) {
        const f = await ctx.phone.forgetAccount();
        phone = ` This phone's ${f.alarms} ${f.alarms === 1 ? "alarm was" : "alarms were"} cancelled and forgotten.`;
      }
      else {
        // An older app: cancel its alarms and drop unsent telemetry with what it has.
        await ctx.phone.reconcile?.({ alarms: [] });
        await ctx.phone.clearTelemetry?.();
        phone = " This phone's alarms were cancelled. Update the app, or clear its storage, to remove their history too.";
      }
    }
    catch (e) {
      phone = ` This phone couldn't be cleared (${e instanceof Error ? e.message : String(e)}): uninstall the app to remove its alarms.`;
    }
  }
  if (ctx.storage) {
    for (const k of browserKeysFor(ctx.storage, ctx.userId)) {
      try {
        ctx.storage.removeItem(k);
      }
      catch {
        // A browser that refuses storage access had nothing stored either.
      }
    }
  }
  const google = result.calendarRevokedAtGoogle === false
    ? " Google didn't confirm it removed SomniAI's calendar access: remove it at myaccount.google.com/permissions."
    : "";
  return {
    ok: true,
    text: "Your account and everything stored with it were deleted." + phone + google
      + " Other phones still signed in can no longer reach the account; uninstall the app there to remove their alarms.",
  };
}
