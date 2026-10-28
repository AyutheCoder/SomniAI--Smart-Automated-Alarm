// Text messages through Twilio's REST API, for the emergency contact (prompt
// 3.3, BUDDY.md "Emergency contact"). The server sends them, so they go even
// when the sleeper's phone is dead or offline, and the app needs no SMS
// permission (Google Play restricts those to default SMS apps).
//
// Without TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM, `configured`
// is false and nothing is sent. A message counts as sent only with Twilio's
// own id for it (its SID): Twilio accepted it for delivery.

export interface SmsResult {
  ok: boolean;
  /** Twilio's message SID, the receipt. */
  messageId?: string;
  error?: string;
}

export interface SmsSender {
  configured: boolean;
  send(to: string, body: string): Promise<SmsResult>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ status: number; json(): Promise<unknown> }>;

/** International format, as Twilio needs it: "+" then 8 to 15 digits. */
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function twilioFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchFn: Fetch = fetch as unknown as Fetch,
): SmsSender {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { configured: false, send: async () => ({ ok: false, error: "SMS is not configured on this server" }) };
  }
  // A messaging service SID ("MG…") or a number to send from.
  const sender: Record<string, string> = from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from };
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  return {
    configured: true,
    async send(to, body) {
      if (!isE164(to)) {
        return { ok: false, error: "the number isn't in international format (+ and country code)" };
      }
      let res;
      try {
        res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${auth}` },
          body: new URLSearchParams({ To: to, Body: body, ...sender }).toString(),
        });
      }
      catch (e) {
        return { ok: false, error: `Twilio unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
      const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
      if (res.status === 201 && typeof json.sid === "string" && json.sid) {
        return { ok: true, messageId: json.sid };
      }
      // Twilio's own words, e.g. 21608: "The number … is unverified. Trial accounts cannot send messages to unverified numbers".
      return { ok: false, error: `Twilio ${res.status}${json.code ? ` ${json.code}` : ""}: ${json.message ?? "no message id"}` };
    },
  };
}
