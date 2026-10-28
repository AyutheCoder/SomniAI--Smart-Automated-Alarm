import { describe, expect, it, vi } from "vitest";
import { isE164, twilioFromEnv } from "./sms";

const ENV = { TWILIO_ACCOUNT_SID: "AC-test-account", TWILIO_AUTH_TOKEN: "secret-token", TWILIO_FROM: "+15005550006" };
type Init = { method: string; headers: Record<string, string>; body: string };

function fake(status: number, body: unknown) {
  const calls: { url: string; init: Init }[] = [];
  const fn = vi.fn(async (url: string, init: Init) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  });
  return { fn, calls };
}

describe("SMS through Twilio", () => {
  it("without the three settings it is not configured and sends nothing", async () => {
    const { fn } = fake(201, { sid: "SM1" });
    for (const env of [{}, { ...ENV, TWILIO_AUTH_TOKEN: "" }, { ...ENV, TWILIO_FROM: undefined }]) {
      const s = twilioFromEnv(env, fn);
      expect(s.configured).toBe(false);
      expect(await s.send("+447700900123", "hi")).toEqual({ ok: false, error: "SMS is not configured on this server" });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("posts the message with basic auth, and counts it sent only with Twilio's SID", async () => {
    const { fn, calls } = fake(201, { sid: "SM0123", status: "queued" });
    expect(await twilioFromEnv(ENV, fn).send("+447700900123", "Sam hasn't confirmed")).toEqual({ ok: true, messageId: "SM0123" });
    expect(calls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Messages.json`);
    expect(calls[0].init.headers.authorization).toBe(`Basic ${Buffer.from(`${ENV.TWILIO_ACCOUNT_SID}:secret-token`).toString("base64")}`);
    const form = new URLSearchParams(calls[0].init.body);
    expect(Object.fromEntries(form)).toEqual({ To: "+447700900123", Body: "Sam hasn't confirmed", From: "+15005550006" });
  });

  it("sends from a messaging service when TWILIO_FROM is one", async () => {
    const { fn, calls } = fake(201, { sid: "SM1" });
    await twilioFromEnv({ ...ENV, TWILIO_FROM: "MG-test-service" }, fn).send("+447700900123", "x");
    expect(new URLSearchParams(calls[0].init.body).get("MessagingServiceSid")).toBe("MG-test-service");
  });

  it("reports Twilio's refusal in its own words", async () => {
    const { fn } = fake(400, { code: 21608, message: "The number +447700900123 is unverified. Trial accounts cannot send messages to unverified numbers" });
    const r = await twilioFromEnv(ENV, fn).send("+447700900123", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Twilio 400 21608: The number +447700900123 is unverified. Trial accounts cannot send messages to unverified numbers");
  });

  it("a 201 without a SID, or no answer, is not a send", async () => {
    expect((await twilioFromEnv(ENV, fake(201, {}).fn).send("+447700900123", "x")).ok).toBe(false);
    const down = vi.fn(async () => { throw new Error("ETIMEDOUT"); });
    expect(await twilioFromEnv(ENV, down).send("+447700900123", "x")).toEqual({ ok: false, error: "Twilio unreachable: ETIMEDOUT" });
  });

  it("only numbers in international format", async () => {
    expect(isE164("+447700900123")).toBe(true);
    expect(isE164("+919876543210")).toBe(true);
    for (const bad of ["07700900123", "+0447700900123", "+44 7700 900123", "+1234567", "+1234567890123456"]) {
      expect(isE164(bad)).toBe(false);
    }
    const { fn } = fake(201, { sid: "SM1" });
    expect((await twilioFromEnv(ENV, fn).send("07700900123", "x")).ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
