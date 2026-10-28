import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fcmFromEnv, serviceAccountJwt } from "./push";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
// As it sits in .env.local: one line, "\n" for the breaks.
const ENV = {
  FIREBASE_PROJECT_ID: "demo-project",
  FIREBASE_CLIENT_EMAIL: "sender@demo-project.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
};

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
function fakeFetch(fcm: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    const r = url.startsWith("https://oauth2.googleapis.com/")
      ? { status: 200, body: { access_token: "ya29.token", expires_in: 3600 } }
      : fcm({ url, init });
    return { status: r.status, json: async () => r.body };
  });
  return { fn, calls };
}

describe("push through Firebase Cloud Messaging", () => {
  it("without credentials it is not configured and sends nothing", async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: {} }));
    for (const env of [{}, { ...ENV, FIREBASE_PRIVATE_KEY: undefined }, { ...ENV, FIREBASE_PROJECT_ID: "" }]) {
      const sender = fcmFromEnv(env, fn);
      expect(sender.configured).toBe(false);
      expect(await sender.send("token", { a: "b" })).toEqual({ ok: false, error: "push is not configured on this server" });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("signs a service-account assertion Google can check", () => {
    const jwt = serviceAccountJwt(ENV.FIREBASE_CLIENT_EMAIL, privateKey, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: ENV.FIREBASE_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const v = createVerify("RSA-SHA256");
    v.update(`${header}.${claims}`);
    expect(v.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("sends a high-priority data message to the token, with the access token", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { name: "projects/demo-project/messages/1" } }));
    const sender = fcmFromEnv(ENV, fn);
    expect(sender.configured).toBe(true);
    expect(await sender.send("device-token", { type: "buddy_alert", name: "Sam" })).toEqual({ ok: true });

    const tokenCall = calls[0];
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(tokenCall.init.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    const send = calls[1];
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/demo-project/messages:send");
    expect(send.init.headers.authorization).toBe("Bearer ya29.token");
    expect(JSON.parse(send.init.body)).toEqual({
      message: { token: "device-token", data: { type: "buddy_alert", name: "Sam" }, android: { priority: "HIGH", ttl: "3600s" } },
    });
  });

  it("reuses the access token until it nearly expires", async () => {
    let t = 1_800_000_000_000;
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const sender = fcmFromEnv(ENV, fn, () => t);
    await sender.send("a", {});
    await sender.send("b", {});
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    t += 3600_000 - 30_000; // within a minute of expiry
    await sender.send("c", {});
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(2);
  });

  it("says when a token is gone, so it can be forgotten", async () => {
    const { fn } = fakeFetch(() => ({ status: 404, body: { error: { status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ errorCode: "UNREGISTERED" }] } } }));
    const r = await fcmFromEnv(ENV, fn).send("old-token", {});
    expect(r.ok).toBe(false);
    expect(r.unregistered).toBe(true);
    expect(r.error).toContain("UNREGISTERED");
  });

  it("reports other failures without forgetting the token", async () => {
    const { fn } = fakeFetch(() => ({ status: 503, body: { error: { status: "UNAVAILABLE", message: "try later" } } }));
    expect(await fcmFromEnv(ENV, fn).send("t", {})).toEqual({ ok: false, unregistered: false, error: "503 UNAVAILABLE try later" });
  });

  it("reports a refused service account and an unreachable service", async () => {
    const refused = vi.fn(async () => ({ status: 400, json: async () => ({ error: "invalid_grant" }) }));
    expect(await fcmFromEnv(ENV, refused).send("t", {})).toEqual({ ok: false, error: "Google refused the service account (400 invalid_grant)" });
    const down = vi.fn(async (url: string) => {
      if (url.includes("oauth2")) {
        return { status: 200, json: async () => ({ access_token: "x", expires_in: 3600 }) };
      }
      throw new Error("ECONNRESET");
    });
    expect(await fcmFromEnv(ENV, down).send("t", {})).toEqual({ ok: false, error: "push service unreachable: ECONNRESET" });
  });
});
