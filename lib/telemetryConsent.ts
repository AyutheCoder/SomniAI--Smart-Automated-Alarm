// What the user agrees to for alarm telemetry (prompt 5.1). The version is
// stored with the consent and with every wake recorded under it; a change to
// what is recorded is a new version, which has to be agreed to again.

export const TELEMETRY_CONSENT = {
  version: "telemetry-v1",
  title: "Alarm telemetry",
  points: [
    "When an alarm rings on this phone, SomniAI records how you woke: how long until you first touched the screen or "
    + "pressed a key, how many times you snoozed, how far the alarm escalated before you stopped it, and how the wake "
    + "check went (passed or not, how many tries, how long it took).",
    "SomniAI uses it to learn how you wake, so it can wake you better. It stays in your SomniAI account and isn't shared "
    + "with anyone.",
    "It records nothing about where you are, what else is on your phone, or anything outside the alarm itself.",
    "Nothing is recorded until you allow it. You can stop at any time, download everything recorded, or delete all of it.",
  ],
  /** What the alarm sends anyway, said plainly so it isn't mistaken for telemetry. */
  separately: "Separately, the alarm itself tells your account when it rang and how it was stopped, for the morning "
    + "report and your wake buddy. That is part of the alarm working, not telemetry, and stays as it was.",
} as const;

export interface TelemetryConsentState {
  granted: boolean;
  version: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
}
