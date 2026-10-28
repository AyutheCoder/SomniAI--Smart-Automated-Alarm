// Keeps the phone's native alarm schedule in step with the server's alarms.
//
// The server owns what alarms exist and how they are set; the phone owns what
// already rang. After every list the page gets from the server (load, create,
// edit, toggle, delete), the whole list goes to the plugin's reconcile, which
// changes only what differs (ReconcilePlan.java, and ANDROID.md, "Keeping the
// phone and the server in step"). Only a list the server returned is ever
// sent: a list that failed to load, or the offline cache, would remove the
// phone's alarms.

import { Capacitor } from "@capacitor/core";
import { SomniAlarm, toNativeAlarm, type NativeAlarm, type SomniAlarmPlugin } from "./nativeAlarm";
import type { Alarm } from "./types";

/** The plugin version this web code needs (reconcile arrived in 2). */
export const REQUIRED_NATIVE_API = 2;

export type ReconcileResult = Awaited<ReturnType<SomniAlarmPlugin["reconcile"]>>;

export type NativeSyncStatus =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; result: ReconcileResult; skipped: string[] }
  | { state: "failed"; error: string; skipped: string[] };

export class NativeSync {
  private pending: { list: NativeAlarm[]; skipped: string[] } | null = null;
  private running: Promise<void> | null = null;
  /** The last list the phone accepted, to skip sending it again unchanged. */
  private lastSent: string | null = null;

  constructor(
    private plugin: Pick<SomniAlarmPlugin, "reconcile">,
    private onStatus: (s: NativeSyncStatus) => void = () => {},
  ) {}

  /**
   * Sends the server's full list of alarms to the phone. Calls made while one
   * is in flight are folded into a single follow-up with the latest list.
   * Resolves once the phone has this list (or the attempt failed).
   */
  sync(alarms: Alarm[]): Promise<void> {
    const list: NativeAlarm[] = [];
    const skipped: string[] = [];
    for (const a of alarms) {
      try {
        list.push(toNativeAlarm(a));
      }
      catch (e) {
        // It has no valid time, so it couldn't ring anyway; say so rather than block the rest.
        skipped.push(`${a._id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.pending = { list, skipped };
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const { list, skipped } = this.pending;
      this.pending = null;
      const key = JSON.stringify(list);
      if (key === this.lastSent) {
        continue;
      }
      this.onStatus({ state: "syncing" });
      try {
        const result = await this.plugin.reconcile({ alarms: list });
        this.lastSent = key;
        this.onStatus({ state: "synced", result, skipped });
      }
      catch (e) {
        // Not marked as sent: the next sync tries again.
        this.lastSent = null;
        this.onStatus({ state: "failed", error: e instanceof Error ? e.message : String(e), skipped });
      }
    }
  }
}

/** What the plugin offers decides the extras shown (3 adds the bedtime check). */
export type NativeConnection = { sync: NativeSync; api: number } | { reason: string };

/**
 * The phone's native schedule, if this page runs in the app and the app is new
 * enough. Otherwise the reason, and the page keeps ringing alarms itself.
 */
export async function connectNative(
  onStatus?: (s: NativeSyncStatus) => void,
  plugin: Pick<SomniAlarmPlugin, "reconcile" | "version"> = SomniAlarm,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): Promise<NativeConnection> {
  if (!isNative()) {
    return { reason: "browser" };
  }
  let api: number;
  try {
    api = (await plugin.version()).api;
  }
  catch {
    return { reason: "This app was built before alarms synced to the phone. Update it." };
  }
  if (typeof api !== "number" || api < REQUIRED_NATIVE_API) {
    return { reason: `This app's alarm code is version ${api}; ${REQUIRED_NATIVE_API} is needed. Update it.` };
  }
  return { sync: new NativeSync(plugin, onStatus), api };
}
