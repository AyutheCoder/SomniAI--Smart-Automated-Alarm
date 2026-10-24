// The wake check is scored in two places: here (web, and the server's verify
// route) and natively on Android (WakeConfidence.java), so an alarm can be
// dismissed with no network and no web view. Both must agree exactly, or the
// phone could dismiss an alarm the server then scores as a failure.
//
// This test computes a table of cases with the TypeScript and checks it against
// the committed table the Java tests read
// (android/app/src/test/resources/wake-confidence-cases.json). If the scoring
// is changed on purpose, regenerate it with
//   WRITE_PARITY=1 npx vitest run lib/wakeConfidence.parity.test.ts
// and the Java tests then fail until WakeConfidence.java matches.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accumulateWakeEvidence, computeWakeConfidence, type ChallengeOutcome, type WakeSignals } from "./wakeConfidence";

const TABLE = join(__dirname, "..", "android", "app", "src", "test", "resources", "wake-confidence-cases.json");

interface Table {
  signals: { in: WakeSignals; score: number; gated: boolean }[];
  sequences: { in: ChallengeOutcome[]; score: number; gated: boolean }[];
}

function build(): Table {
  const signals: Table["signals"] = [];
  for (const correctness of [0, 0.5, 1]) {
    for (const solved of [undefined, false, true]) {
      for (const responseMs of [0, 3000, 6000, 20000, 45000, 90000]) {
        for (const attempts of [0, 1, 2, 5]) {
          for (const motion of [undefined, 0, 0.5, 1]) {
            for (const interactions of [undefined, 0, 6, 50]) {
              const input: WakeSignals = { correctness, responseMs, attempts };
              if (solved !== undefined) input.solved = solved;
              if (motion !== undefined) input.motion = motion;
              if (interactions !== undefined) input.interactions = interactions;
              const r = computeWakeConfidence(input);
              signals.push({ in: input, score: r.score, gated: r.gated });
            }
          }
        }
      }
    }
  }
  const o = (solved: boolean, responseMs: number, attempts: number, motion?: number, interactions?: number): ChallengeOutcome => {
    const out: ChallengeOutcome = { solved, responseMs, attempts };
    if (motion !== undefined) out.motion = motion;
    if (interactions !== undefined) out.interactions = interactions;
    return out;
  };
  const seqs: ChallengeOutcome[][] = [
    [],
    [o(true, 4000, 1, 0.6, 3)],
    [o(true, 4000, 1, 0.6, 3), o(true, 4000, 1, 0.6, 3)],
    [o(true, 4000, 1, 0.6, 3), o(false, 4000, 1, 0.6, 3)],
    [o(true, 4000, 1, 0.6, 3), o(true, 4000, 1, 0.6, 3), o(true, 4000, 1, 0.6, 3), o(false, 4000, 1, 0.6, 3)],
    [o(true, 3000, 1), o(true, 3000, 1)],
    [o(true, 20000, 3), o(true, 20000, 3)],
    [o(true, 9000, 2, 0.9), o(true, 7000, 1)],
    [o(true, 12000, 0), o(true, 15000, 4, 0.2, 2), o(true, 2000, 1, 1, 10)],
    [o(false, 1000, 1, 1, 50)],
    [o(true, 45000, 6, 0, 0)],
    [o(true, 25000, 3, 0.4, 3)],
  ];
  const sequences = seqs.map((s) => {
    const r = accumulateWakeEvidence(s);
    return { in: s, score: r.score, gated: r.gated };
  });
  return { signals, sequences };
}

describe("wake-confidence parity table", () => {
  it("matches the table the Android tests check WakeConfidence.java against", () => {
    const table = build();
    if (process.env.WRITE_PARITY === "1") {
      writeFileSync(TABLE, JSON.stringify(table) + "\n");
    }
    expect(JSON.parse(readFileSync(TABLE, "utf8"))).toEqual(table);
    // Enough cases to matter, and both sides of the gate represented.
    expect(table.signals.length).toBeGreaterThan(2000);
    expect(table.signals.some((c) => c.gated)).toBe(true);
    expect(table.signals.some((c) => c.score >= 85)).toBe(true);
  });
});
