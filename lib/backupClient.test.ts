import { describe, expect, it, vi } from "vitest";
import { laterLine } from "./backupAdapters";
import { requestBackupsFromServer } from "./backupClient";

const reply = (status: number, data: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => ({ ok: status < 300, data }) }));
const receipt = { transport: "fcm", messageId: "projects/p/messages/1", at: "2026-10-28T07:01:15.000Z" };
const LATER = [{ who: "buddy", name: "Bo", at: "2026-10-28T07:15:00.000Z" }, { who: "emergencyContact", name: "Mum", at: "2026-10-28T07:15:00.000Z" }];

describe("the backup level from a ringing page", () => {
  it("asks the server and keeps its checked answers", async () => {
    const post = reply(200, {
      outcomes: [
        { kind: "secondaryAlarm", status: "delivered", receipt },
        { kind: "smartwatch", status: "not_configured", reason: "no watch app" },
      ],
      later: LATER,
    });
    const r = await requestBackupsFromServer("a1", ["secondaryAlarm", "smartwatch", "emergencyContact"], post);
    expect(post).toHaveBeenCalledWith("/api/alarms/a1/backups", { kinds: ["secondaryAlarm", "smartwatch", "emergencyContact"] });
    expect(r.outcomes).toEqual([
      { kind: "secondaryAlarm", label: "Second device", status: "delivered", receipt },
      { kind: "smartwatch", label: "Smartwatch", status: "not_configured", reason: "no watch app" },
    ]);
    expect(r.later).toEqual(LATER);
  });

  it("doesn't take a delivery without a receipt, an unknown status, or silence", async () => {
    const r = await requestBackupsFromServer("a1", ["secondaryAlarm", "smartwatch", "emergencyContact"], reply(200, {
      outcomes: [{ kind: "secondaryAlarm", status: "delivered" }, { kind: "smartwatch", status: "triggered" }],
    }));
    expect(r.outcomes.map((o) => o.status)).toEqual(["failed", "failed", "failed"]);
    expect(r.outcomes[2]).toMatchObject({ reason: "the server didn't answer for it" });
  });

  it("everything failed when the server can't be reached or refuses", async () => {
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect((await requestBackupsFromServer("a1", ["secondaryAlarm"], down)).outcomes)
      .toEqual([{ kind: "secondaryAlarm", label: "Second device", status: "failed", reason: "couldn't reach the server" }]);
    expect((await requestBackupsFromServer("a1", ["secondaryAlarm"], reply(401, null))).outcomes[0])
      .toMatchObject({ status: "failed", reason: "the server said 401" });
  });

  it("says who will be told and when", () => {
    const clock = (d: Date) => d.toISOString().slice(11, 16);
    expect(laterLine([], clock)).toBeNull();
    expect(laterLine(LATER as never, clock)).toBe("Your buddy Bo and Mum will be told at 07:15 if you haven't answered.");
    expect(laterLine([LATER[1]] as never, clock)).toBe("Mum will be told at 07:15 if you haven't answered.");
  });
});
