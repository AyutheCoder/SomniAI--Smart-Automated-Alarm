// Backup channels: who or what the alarm reaches when the sleeper has not
// responded by the last escalation level.
//
// Every channel reports exactly one outcome, and "delivered" means a transport
// (a push service, an SMS or e-mail gateway) accepted the message and returned
// its own id for it. That is enforced in one place, dispatchBackups: whatever a
// channel returns, a "delivered" without a transport receipt is reported as a
// failure. A channel with no target or no transport is "not_configured" and
// sends nothing.
//
// This replaces adapters that printed "Triggered a backup alarm…" for channels
// that sent nothing. No transport exists in the app yet (prompt 3.3 adds real
// ones), so today every channel truthfully reports "not set up".

export const BACKUP_KINDS = ["secondaryAlarm", "smartwatch", "emergencyContact"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BACKUP_LABELS: Record<BackupKind, string> = {
  secondaryAlarm: "Second device",
  smartwatch: "Smartwatch",
  emergencyContact: "Emergency contact",
};

export type BackupStatus = "delivered" | "failed" | "not_configured";
export const BACKUP_STATUSES: readonly BackupStatus[] = ["delivered", "failed", "not_configured"];

/** Proof that a message left: the transport that accepted it and its id for it. */
export interface DeliveryReceipt {
  transport: string;
  messageId: string;
  at: string;
}

interface OutcomeBase {
  kind: BackupKind;
  label: string;
}
export type BackupOutcome =
  | (OutcomeBase & { status: "delivered"; receipt: DeliveryReceipt })
  | (OutcomeBase & { status: "failed"; reason: string })
  | (OutcomeBase & { status: "not_configured"; reason: string });

export interface BackupMessage {
  alarmLabel: string;
  text: string;
}

/**
 * Something that actually sends. `send` resolves only once the service has
 * accepted the message, with the service's id for it, and rejects otherwise.
 */
export interface Transport {
  name: string;
  send(to: string, message: BackupMessage): Promise<{ messageId: string }>;
}

export interface BackupChannel {
  kind: BackupKind;
  deliver(message: BackupMessage): Promise<BackupOutcome>;
}

/** What the user has set up. Each channel needs both a target and a transport. */
export interface BackupConfig {
  pairedDevice?: { id: string };
  watch?: { id: string };
  emergencyContact?: { name: string; channel: "email" | "sms"; value: string };
  transports?: {
    push?: Transport;
    watch?: Transport;
    email?: Transport;
    sms?: Transport;
  };
}

/** How long a transport gets before the attempt counts as failed. */
export const SEND_TIMEOUT_MS = 10_000;

const notConfigured = (kind: BackupKind, reason: string): BackupOutcome =>
  ({ kind, label: BACKUP_LABELS[kind], status: "not_configured", reason });

const failed = (kind: BackupKind, reason: string): BackupOutcome =>
  ({ kind, label: BACKUP_LABELS[kind], status: "failed", reason });

function hasReceipt(r: unknown): r is DeliveryReceipt {
  const x = r as Partial<DeliveryReceipt> | null | undefined;
  return typeof x?.transport === "string" && x.transport.trim() !== ""
    && typeof x.messageId === "string" && x.messageId.trim() !== ""
    && typeof x.at === "string" && !Number.isNaN(Date.parse(x.at));
}

/** Sends through a transport; "delivered" only with the transport's own id. */
async function sendVia(kind: BackupKind, transport: Transport, to: string, message: BackupMessage): Promise<BackupOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS);
    });
    const result = await Promise.race([transport.send(to, message), timeout]);
    const messageId = typeof result?.messageId === "string" ? result.messageId.trim() : "";
    if (!messageId) {
      return failed(kind, `${transport.name} did not confirm the message`);
    }
    return {
      kind,
      label: BACKUP_LABELS[kind],
      status: "delivered",
      receipt: { transport: transport.name, messageId, at: new Date().toISOString() },
    };
  }
  catch (e) {
    return failed(kind, `${transport.name}: ${e instanceof Error ? e.message : "send failed"}`);
  }
  finally {
    clearTimeout(timer);
  }
}

/** A channel that needs a target and a transport, and is not set up without either. */
function transportChannel(
  kind: BackupKind,
  target: string | undefined,
  transport: Transport | undefined,
  missing: { target: string; transport: string },
): BackupChannel {
  return {
    kind,
    async deliver(message) {
      if (!target) {
        return notConfigured(kind, missing.target);
      }
      if (!transport) {
        return notConfigured(kind, missing.transport);
      }
      return sendVia(kind, transport, target, message);
    },
  };
}

export function createBackupChannels(config: BackupConfig = {}): Record<BackupKind, BackupChannel> {
  const t = config.transports ?? {};
  const contact = config.emergencyContact;
  return {
    secondaryAlarm: transportChannel("secondaryAlarm", config.pairedDevice?.id, t.push, {
      target: "No second device is paired",
      transport: "Push to a second device isn't available yet",
    }),
    smartwatch: transportChannel("smartwatch", config.watch?.id, t.watch, {
      target: "No smartwatch is connected",
      transport: "Smartwatch alerts aren't available yet",
    }),
    emergencyContact: transportChannel("emergencyContact", contact?.value?.trim() || undefined,
      contact ? t[contact.channel] : undefined, {
        target: "No emergency contact is set",
        transport: "Messaging an emergency contact isn't available yet",
      }),
  };
}

/**
 * Tries each requested channel and reports what really happened. This is the
 * only way outcomes reach the rest of the app, and the one place that checks
 * them: a channel that throws has failed, and a "delivered" without a valid
 * receipt is reported as failed, however the channel came to claim it.
 */
export async function dispatchBackups(
  kinds: readonly BackupKind[],
  message: BackupMessage,
  channels: Partial<Record<BackupKind, BackupChannel>> = createBackupChannels(),
): Promise<BackupOutcome[]> {
  return Promise.all(kinds.map(async (kind): Promise<BackupOutcome> => {
    const channel = channels[kind];
    if (!channel) {
      return notConfigured(kind, "This backup isn't available");
    }
    let outcome: BackupOutcome;
    try {
      outcome = await channel.deliver(message);
    }
    catch (e) {
      return failed(kind, e instanceof Error ? e.message : "Backup failed");
    }
    if (outcome?.status === "delivered" && !hasReceipt(outcome.receipt)) {
      return failed(kind, "Reported delivery without a receipt from a transport");
    }
    if (!outcome || !BACKUP_STATUSES.includes(outcome.status)) {
      return failed(kind, "Backup returned no outcome");
    }
    return { ...outcome, kind, label: BACKUP_LABELS[kind] };
  }));
}

/** What the UI shows for an outcome. Only a delivery reads as sent. */
export function describeOutcome(outcome: BackupOutcome): string {
  switch (outcome.status) {
    case "delivered":
      return "sent";
    case "failed":
      return `failed: ${outcome.reason}`;
    case "not_configured":
      return "not set up";
  }
}
