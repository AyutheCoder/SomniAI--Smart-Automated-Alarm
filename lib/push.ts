// Push to a phone through Firebase Cloud Messaging's HTTP v1 API, signed with
// a service account (BUDDY.md says where the three values come from). No SDK:
// the service-account JWT is signed with Node's crypto, and fetch does the rest.
//
// Without the credentials, nothing pretends to send: `configured` is false and
// every send reports "not configured".

import { createSign } from "node:crypto";

export interface PushResult {
  ok: boolean;
  /** Firebase's own id for an accepted message ("projects/…/messages/…"): the delivery receipt. */
  messageId?: string;
  /** The token no longer reaches an app (uninstalled, or a new token): forget it. */
  unregistered?: boolean;
  error?: string;
}

export interface PushSender {
  configured: boolean;
  /** A data message: the app builds the notification itself (with its call button). */
  send(token: string, data: Record<string, string>): Promise<PushResult>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ status: number; json(): Promise<unknown> }>;

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const base64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** The service account's signed assertion, exchanged for an access token. */
export function serviceAccountJwt(clientEmail: string, privateKey: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(privateKey).toString("base64url")}`;
}

export function fcmFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchFn: Fetch = fetch as unknown as Fetch,
  now: () => number = Date.now,
): PushSender {
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  // .env files hold the key on one line, with "\n" for its line breaks.
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    return { configured: false, send: async () => ({ ok: false, error: "push is not configured on this server" }) };
  }

  let cached: { token: string; until: number } | null = null;
  async function accessToken(): Promise<string> {
    if (cached && cached.until > now() + 60_000) {
      return cached.token;
    }
    const assertion = serviceAccountJwt(clientEmail!, privateKey!, Math.floor(now() / 1000));
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (res.status !== 200 || !body.access_token) {
      throw new Error(`Google refused the service account (${res.status} ${body.error ?? ""})`.trim());
    }
    cached = { token: body.access_token, until: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  return {
    configured: true,
    async send(token, data) {
      let bearer: string;
      try {
        bearer = await accessToken();
      }
      catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      let res;
      try {
        res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          // High priority so a dozing phone shows it now; an hour on, it's no use.
          body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: "3600s" } } }),
        });
      }
      catch (e) {
        return { ok: false, error: `push service unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (res.status === 200) {
        const accepted = (await res.json().catch(() => ({}))) as { name?: string };
        // Accepted only with Firebase's id for it: without one, nothing proves it left.
        return typeof accepted.name === "string" && accepted.name
          ? { ok: true, messageId: accepted.name }
          : { ok: false, error: "Firebase answered without a message id" };
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
      };
      const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? "";
      // A token that was never valid is answered 400 INVALID_ARGUMENT, "The registration
      // token is not a valid FCM registration token" (seen against the real service).
      const badToken = code === "INVALID_ARGUMENT" && /registration token/i.test(body.error?.message ?? "");
      return {
        ok: false,
        unregistered: res.status === 404 || code === "UNREGISTERED" || badToken,
        error: `${res.status} ${code} ${body.error?.message ?? ""}`.trim(),
      };
    },
  };
}
