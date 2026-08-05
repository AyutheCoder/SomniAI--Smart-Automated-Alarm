import type { BackupKind } from "./escalation";
import { notify, speak, vibrate } from "./clientAlarm";
export interface BackupResult {
  kind: BackupKind;
  label: string;
  detail: string;
}
const LABELS: Record<BackupKind, string> = {
  secondaryAlarm: "Secondary alarm",
  smartwatch: "Smartwatch buzz",
  smartLight: "Smart light",
  smartSpeaker: "Smart speaker",
  emergencyContact: "Emergency contact",
};
export function triggerBackup(kind: BackupKind, ctx: {
  alarmLabel: string;
}): BackupResult {
  let detail = "";
  switch (kind) {
    case "secondaryAlarm":
      detail = "Triggered a backup alarm on a paired device (mock).";
      break;
    case "smartwatch":
      vibrate("aggressive");
      detail = "Sent an aggressive buzz to your smartwatch (mock).";
      break;
    case "smartLight":
      detail = "Flashed the bedroom smart lights to full brightness (mock).";
      break;
    case "smartSpeaker":
      speak(`Wake up. This is an emergency alarm for ${ctx.alarmLabel}.`);
      detail = "Announced the alarm over your smart speaker (mock).";
      break;
    case "emergencyContact":
      notify("SomniAI emergency escalation", "Your emergency contact would be notified that you have not woken up.");
      detail = "Would notify your emergency contact (mock - no message sent).";
      break;
  }
  console.info(`[backup:${kind}] ${detail}`);
  return { kind, label: LABELS[kind], detail };
}
export function triggerBackups(kinds: BackupKind[], ctx: {
  alarmLabel: string;
}): BackupResult[] {
  return kinds.map((k) => triggerBackup(k, ctx));
}