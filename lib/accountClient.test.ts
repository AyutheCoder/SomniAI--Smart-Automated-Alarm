import { describe, expect, it, vi } from "vitest";
import { browserKeysFor, deleteMyAccount, FORGET_API } from "./accountClient";

function memoryStorage(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const ME = "64f000000000000000000001";
const deleted = vi.fn(async () => ({ ok: true, status: 200, data: { calendarRevokedAtGoogle: true } }));

describe("deleting the account from the page", () => {
  it("clears this phone and this browser only after the server deleted everything", async () => {
    const phone = { forgetAccount: vi.fn(async () => ({ alarms: 3, unsent: 1 })) };
    const storage = memoryStorage({
      [`somniai.alarms.v1:${ME}`]: "[]", [`somniai.outbox.v1:${ME}`]: "[]", [`somniai.bedtime.v1:${ME}`]: "{}",
      "somniai.alarms.v1:someone-else": "[]", "unrelated": "1",
    });
    const out = await deleteMyAccount({ confirm: "me@example.org", password: "pw" }, { userId: ME, phone, api: FORGET_API, storage }, deleted);
    expect(out.ok).toBe(true);
    expect(phone.forgetAccount).toHaveBeenCalledOnce();
    expect(out.text).toMatch(/3 alarms were cancelled and forgotten/);
    expect(browserKeysFor(storage, ME)).toEqual([]);
    expect(storage.getItem("somniai.alarms.v1:someone-else")).toBe("[]");
    expect(storage.getItem("unrelated")).toBe("1");
  });

  it("clears nothing when the server refuses, so the alarms keep ringing", async () => {
    const phone = { forgetAccount: vi.fn(async () => ({ alarms: 3, unsent: 0 })) };
    const storage = memoryStorage({ [`somniai.alarms.v1:${ME}`]: "[]" });
    const refused = vi.fn(async () => ({ ok: false, status: 403, error: "That password isn't right." }));
    const out = await deleteMyAccount({ confirm: "me@example.org", password: "no" }, { userId: ME, phone, api: FORGET_API, storage }, refused);
    expect(out).toEqual({ ok: false, text: "That password isn't right." });
    expect(phone.forgetAccount).not.toHaveBeenCalled();
    expect(storage.getItem(`somniai.alarms.v1:${ME}`)).toBe("[]");
  });

  it("with an older app, cancels its alarms with what it has, and says what's left", async () => {
    const phone = { reconcile: vi.fn(async () => ({}) as never), clearTelemetry: vi.fn(async () => ({}) as never) };
    const out = await deleteMyAccount({ confirm: "me@example.org" }, { userId: ME, phone, api: 7, storage: null }, deleted);
    expect(phone.reconcile).toHaveBeenCalledWith({ alarms: [] });
    expect(out.text).toMatch(/Update the app, or clear its storage/);
  });

  it("says so if the phone couldn't be cleared, and if Google didn't confirm the calendar", async () => {
    const phone = { forgetAccount: vi.fn(async () => { throw new Error("busy"); }) };
    const unconfirmed = vi.fn(async () => ({ ok: true, status: 200, data: { calendarRevokedAtGoogle: false } }));
    const out = await deleteMyAccount({ confirm: "me@example.org" }, { userId: ME, phone, api: FORGET_API, storage: null }, unconfirmed);
    expect(out.ok).toBe(true);
    expect(out.text).toMatch(/couldn't be cleared \(busy\): uninstall the app/);
    expect(out.text).toMatch(/myaccount\.google\.com\/permissions/);
  });
});
