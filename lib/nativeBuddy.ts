// Wake buddy, phone side (prompt 3.2): the app's push token goes to the
// server, so a buddy's alerts reach this phone. Called whenever the app opens
// in the native shell; a token Firebase replaced is sent again then.

import { SomniAlarm, type SomniAlarmPlugin } from "./nativeAlarm";
import type { NativeConnection } from "./nativeSync";

/** The plugin version with pushToken. */
export const PUSH_API = 4;

export type PushRegistration =
  | { state: "registered" }
  | { state: "unavailable"; reason: string }
  | { state: "failed"; reason: string };

type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number }>;

const postJson: Post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status };
};

export function hasPush(native: NativeConnection | null): boolean {
  return native !== null && "api" in native && native.api >= PUSH_API;
}

export async function registerPush(
  plugin: Pick<SomniAlarmPlugin, "pushToken"> = SomniAlarm,
  post: Post = postJson,
): Promise<PushRegistration> {
  let token: Awaited<ReturnType<SomniAlarmPlugin["pushToken"]>>;
  try {
    token = await plugin.pushToken();
  }
  catch (e) {
    return { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
  if (!token.available || !token.token) {
    return { state: "unavailable", reason: token.reason ?? "This phone can't receive push messages." };
  }
  try {
    const res = await post("/api/push/token", { token: token.token });
    return res.ok ? { state: "registered" } : { state: "failed", reason: `The server said ${res.status}.` };
  }
  catch {
    return { state: "failed", reason: "Couldn't reach the server. It's tried again next time the app opens." };
  }
}
