// Alerts to whoever runs SomniAI (prompt 7.3): one message to a webhook they
// choose, OPS_ALERT_WEBHOOK. Discord and Slack incoming webhooks take JSON
// (`content` and `text`; both are sent), ntfy takes the message as plain text
// (ntfy.sh is recognised; a self-hosted ntfy needs OPS_ALERT_FORMAT=text).
// Without a webhook the alert is "not_configured", never reported as sent;
// "delivered" means the webhook answered 2xx.

import type { AlertStatus } from "@/models/ServiceStatus";

export interface AlertResult {
  status: AlertStatus;
  detail?: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number }>;

export async function sendOpsAlert(
  text: string,
  env: Record<string, string | undefined> = process.env,
  fetchFn: Fetch = fetch as unknown as Fetch,
): Promise<AlertResult> {
  const raw = env.OPS_ALERT_WEBHOOK?.trim();
  if (!raw) {
    return { status: "not_configured", detail: "OPS_ALERT_WEBHOOK is not set" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  }
  catch {
    return { status: "failed", detail: "OPS_ALERT_WEBHOOK is not a URL" };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return { status: "failed", detail: "OPS_ALERT_WEBHOOK must be https" };
  }
  const plain = env.OPS_ALERT_FORMAT === "text" || /(^|\.)ntfy\.sh$/.test(url.hostname);
  try {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers: { "content-type": plain ? "text/plain; charset=utf-8" : "application/json" },
      body: plain ? text : JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? { status: "delivered", detail: `HTTP ${res.status}` } : { status: "failed", detail: `the webhook answered ${res.status}` };
  }
  catch (e) {
    return { status: "failed", detail: `couldn't reach the webhook (${e instanceof Error ? e.message : String(e)})` };
  }
}
