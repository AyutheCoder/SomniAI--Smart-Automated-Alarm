import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_KINDS,
  SEND_TIMEOUT_MS,
  createBackupChannels,
  describeOutcome,
  dispatchBackups,
  type BackupChannel,
  type BackupConfig,
  type BackupKind,
  type BackupOutcome,
  type Transport,
} from "./backupAdapters";

const MESSAGE = { alarmLabel: "Exam", text: "SomniAI: Exam has not been answered." };

/** A config where every channel has a target and the given transport. */
function fullyConfigured(transport: Transport, contactChannel: "email" | "sms" = "sms"): BackupConfig {
  return {
    pairedDevice: { id: "device-1" },
    watch: { id: "watch-1" },
    emergencyContact: { name: "Contact", channel: contactChannel, value: "+10000000000" },
    transports: { push: transport, watch: transport, email: transport, sms: transport },
  };
}

const confirming = (id = "msg-123"): Transport => ({
  name: "test-gateway",
  send: vi.fn(async () => ({ messageId: id })),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the channels that exist", () => {
  it("are a second device, a smartwatch and an emergency contact; smart lights and speakers are gone", () => {
    expect([...BACKUP_KINDS]).toEqual(["secondaryAlarm", "smartwatch", "emergencyContact"]);
  });
});

describe("as the app ships today, with nothing set up", () => {
  it("reports every channel as not set up and sends nothing", async () => {
    const outcomes = await dispatchBackups(BACKUP_KINDS, MESSAGE);
    expect(outcomes.map((o) => [o.kind, o.status])).toEqual([
      ["secondaryAlarm", "not_configured"],
      ["smartwatch", "not_configured"],
      ["emergencyContact", "not_configured"],
    ]);
    expect(outcomes.map(describeOutcome)).toEqual(["not set up", "not set up", "not set up"]);
  });
});

describe("a channel is not set up without both a target and a transport", () => {
  it.each(BACKUP_KINDS)("%s with a transport but no target sends nothing", async (kind) => {
    const transport = confirming();
    const channels = createBackupChannels({ transports: { push: transport, watch: transport, email: transport, sms: transport } });
    const [outcome] = await dispatchBackups([kind], MESSAGE, channels);
    expect(outcome.status).toBe("not_configured");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it.each(BACKUP_KINDS)("%s with a target but no transport sends nothing", async (kind) => {
    const config = fullyConfigured(confirming());
    delete config.transports;
    const [outcome] = await dispatchBackups([kind], MESSAGE, createBackupChannels(config));
    expect(outcome.status).toBe("not_configured");
  });

  it("an emergency contact with a blank number is not set up", async () => {
    const transport = confirming();
    const config = fullyConfigured(transport);
    config.emergencyContact!.value = "   ";
    const [outcome] = await dispatchBackups(["emergencyContact"], MESSAGE, createBackupChannels(config));
    expect(outcome.status).toBe("not_configured");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("an emergency contact by e-mail needs the e-mail transport, not the SMS one", async () => {
    const sms = confirming();
    const config: BackupConfig = {
      emergencyContact: { name: "Contact", channel: "email", value: "contact@example.test" },
      transports: { sms },
    };
    const [outcome] = await dispatchBackups(["emergencyContact"], MESSAGE, createBackupChannels(config));
    expect(outcome.status).toBe("not_configured");
    expect(sms.send).not.toHaveBeenCalled();
  });
});

/** Every way a transport can fall short of confirming a delivery. */
const UNCONFIRMED: [string, () => Transport][] = [
  ["rejects", () => ({ name: "t", send: async () => { throw new Error("gateway down"); } })],
  ["throws before returning a promise", () => ({ name: "t", send: () => { throw new Error("bad config"); } })],
  ["resolves with no id", () => ({ name: "t", send: async () => ({}) as { messageId: string } })],
  ["resolves with an empty id", () => ({ name: "t", send: async () => ({ messageId: "" }) })],
  ["resolves with a blank id", () => ({ name: "t", send: async () => ({ messageId: "   " }) })],
  ["resolves with a non-string id", () => ({ name: "t", send: async () => ({ messageId: 42 as unknown as string }) })],
  ["resolves with nothing", () => ({ name: "t", send: async () => undefined as unknown as { messageId: string } })],
  ["resolves with null", () => ({ name: "t", send: async () => null as unknown as { messageId: string } })],
];

describe("no code path returns delivered without a confirmed delivery", () => {
  for (const kind of BACKUP_KINDS) {
    it.each(UNCONFIRMED)(`${kind}: a transport that %s is a failure`, async (_how, make) => {
      const [outcome] = await dispatchBackups([kind], MESSAGE, createBackupChannels(fullyConfigured(make())));
      expect(outcome.status).toBe("failed");
      expect(describeOutcome(outcome)).toMatch(/^failed: /);
    });
  }

  it.each(BACKUP_KINDS)("%s: a transport that never answers fails after the timeout", async (kind) => {
    vi.useFakeTimers();
    const hanging: Transport = { name: "t", send: () => new Promise(() => {}) };
    const pending = dispatchBackups([kind], MESSAGE, createBackupChannels(fullyConfigured(hanging)));
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    const [outcome] = await pending;
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toMatch(/no answer within/);
  });

  it.each([
    ["delivered with no receipt", { status: "delivered" }],
    ["delivered with an empty message id", { status: "delivered", receipt: { transport: "t", messageId: "", at: new Date().toISOString() } }],
    ["delivered with no transport named", { status: "delivered", receipt: { transport: "", messageId: "x", at: new Date().toISOString() } }],
    ["delivered with an invalid time", { status: "delivered", receipt: { transport: "t", messageId: "x", at: "soon" } }],
  ])("the dispatcher overrules a channel that claims %s", async (_what, claim) => {
    const rogue: BackupChannel = {
      kind: "smartwatch",
      deliver: async () => ({ kind: "smartwatch", label: "x", ...claim }) as BackupOutcome,
    };
    const [outcome] = await dispatchBackups(["smartwatch"], MESSAGE, { smartwatch: rogue });
    expect(outcome.status).toBe("failed");
    expect(describeOutcome(outcome)).not.toBe("sent");
  });

  it.each([
    ["throws", async () => { throw new Error("boom"); }],
    ["returns nothing", async () => undefined as unknown as BackupOutcome],
    ["returns an unknown status", async () => ({ kind: "smartwatch", label: "x", status: "triggered" }) as unknown as BackupOutcome],
  ])("the dispatcher reports a channel that %s as failed", async (_what, deliver) => {
    const [outcome] = await dispatchBackups(["smartwatch"], MESSAGE, { smartwatch: { kind: "smartwatch", deliver } });
    expect(outcome.status).toBe("failed");
  });

  it("a channel missing from the registry is not set up, not skipped", async () => {
    const outcomes = await dispatchBackups(BACKUP_KINDS, MESSAGE, {});
    expect(outcomes.map((o) => o.status)).toEqual(["not_configured", "not_configured", "not_configured"]);
  });

  it("nothing outside the transport send path in lib/backupAdapters.ts writes status \"delivered\"", () => {
    const root = process.cwd();
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(dir, e.name)] : []);
    const sources = ["app", "lib"].flatMap((dir) => walk(dir));
    const writers = sources.flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");
      // Writes of the value, not the `status: "delivered";` member of the type.
      const count = (text.match(/status:\s*"delivered"(?!\s*;)/g) ?? []).length;
      return count > 0 ? [[file.split("\\").join("/"), count] as const] : [];
    });
    expect(writers).toEqual([["lib/backupAdapters.ts", 1]]);
  });
});

describe("a real delivery", () => {
  it.each(BACKUP_KINDS)("%s is delivered only with the transport's own id for the message", async (kind) => {
    const transport = confirming("gw-789");
    const [outcome] = await dispatchBackups([kind], MESSAGE, createBackupChannels(fullyConfigured(transport)));
    expect(outcome.status).toBe("delivered");
    expect(outcome.status === "delivered" && outcome.receipt).toMatchObject({ transport: "test-gateway", messageId: "gw-789" });
    expect(describeOutcome(outcome)).toBe("sent");
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("sends to the configured target", async () => {
    const transport = confirming();
    await dispatchBackups(["emergencyContact", "secondaryAlarm", "smartwatch"], MESSAGE, createBackupChannels(fullyConfigured(transport)));
    const targets = (transport.send as ReturnType<typeof vi.fn>).mock.calls.map(([to]) => to);
    expect(targets.sort()).toEqual(["+10000000000", "device-1", "watch-1"]);
  });

  it("one channel failing does not stop or taint the others", async () => {
    const good = confirming();
    const bad: Transport = { name: "sms-gw", send: async () => { throw new Error("rejected"); } };
    const config = fullyConfigured(good);
    config.transports!.sms = bad;
    const outcomes = await dispatchBackups(BACKUP_KINDS, MESSAGE, createBackupChannels(config));
    const byKind = Object.fromEntries(outcomes.map((o) => [o.kind, o.status])) as Record<BackupKind, string>;
    expect(byKind).toEqual({ secondaryAlarm: "delivered", smartwatch: "delivered", emergencyContact: "failed" });
  });
});

describe("what the UI says", () => {
  it("only a delivery reads as sent; an unconfigured channel reads as not set up", () => {
    const base = { kind: "smartwatch" as const, label: "Smartwatch" };
    expect(describeOutcome({ ...base, status: "not_configured", reason: "No smartwatch is connected" })).toBe("not set up");
    expect(describeOutcome({ ...base, status: "failed", reason: "gateway down" })).toBe("failed: gateway down");
    expect(describeOutcome({ ...base, status: "delivered", receipt: { transport: "t", messageId: "1", at: new Date().toISOString() } })).toBe("sent");
  });
});
