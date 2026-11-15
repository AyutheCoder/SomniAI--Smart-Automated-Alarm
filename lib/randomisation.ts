// Randomising one aspect of waking per alarm (prompt 6.1), for the study in
// Phase 6. Pure; lib/randomisationServer.ts assigns and logs.
//
// One experiment at a time, two arms each:
//   escalation_pacing  "standard" or "stretched" (each level starts 1.5x later)
//   wake_plan          "shown" or "not_shown" (the planner declines to plan
//                      for that alarm's wake time)
//
// Balanced and reproducible: permuted blocks of BLOCK_SIZE (two of each arm),
// each block's order drawn from a generator seeded by the experiment's seed,
// the user and the block number. An assignment is therefore a function of
// (seed, user, experiment, sequence number): auditAssignments recomputes every
// logged arm from the seed. Within every complete block the arms are equal, so
// at any point they differ by at most BLOCK_SIZE / 2.
//
// An unmissable alarm is never randomised: it draws no arm and takes no
// sequence number, so the randomised alarms stay balanced among themselves.

import type { EscalationLevel } from "./escalation";

export const EXPERIMENTS = {
  escalation_pacing: { arms: ["standard", "stretched"] as const, label: "Escalation pacing" },
  wake_plan: { arms: ["shown", "not_shown"] as const, label: "Whether the wake plan is shown" },
} as const;

export type Experiment = keyof typeof EXPERIMENTS;
export type Arm = (typeof EXPERIMENTS)[Experiment]["arms"][number];

/** Said when the study withholds the wake plan for an alarm. */
export const WITHHELD_TEXT = "For this alarm, the study you're in doesn't show a wake plan. That was decided at random when the alarm was set, and it's part of how the study learns whether plans help.";

export const BLOCK_SIZE = 4;
/** The stretched arm: each level of the ladder starts this much later. */
export const STRETCH = 1.5;

export function isExperiment(v: unknown): v is Experiment {
  return typeof v === "string" && v in EXPERIMENTS;
}

/** 32-bit FNV-1a: the same string always gives the same number, on any machine. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, uniform on [0, 1). */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One block's arms in order: two of each, shuffled (Fisher-Yates) by the seeded generator. */
export function blockOrder(seed: string, userId: string, experiment: Experiment, block: number): Arm[] {
  const [a, b] = EXPERIMENTS[experiment].arms;
  const arms: Arm[] = [];
  for (let i = 0; i < BLOCK_SIZE / 2; i++) {
    arms.push(a, b);
  }
  const rand = generator(hash32(`${seed}|${userId}|${experiment}|${block}`));
  for (let i = arms.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arms[i], arms[j]] = [arms[j], arms[i]];
  }
  return arms;
}

/** The arm of the sequence-th randomised alarm (0-based). */
export function armFor(seed: string, userId: string, experiment: Experiment, sequence: number): Arm {
  return blockOrder(seed, userId, experiment, Math.floor(sequence / BLOCK_SIZE))[sequence % BLOCK_SIZE];
}

/** The ladder for a pacing arm: stretched starts every level STRETCH times later; standard is unchanged. */
export function pacedEscalation(levels: EscalationLevel[], arm: Arm): EscalationLevel[] {
  return arm === "stretched" ? levels.map((l) => ({ ...l, afterSeconds: Math.round(l.afterSeconds * STRETCH) })) : levels;
}

export interface LoggedAssignment {
  userId: string;
  experiment: Experiment;
  seed: string;
  sequence: number | null;
  arm: Arm | null;
  excluded: "unmissable" | null;
}

/** Every logged arm recomputed from its seed: the ones that don't match (none, unless the log was altered). */
export function auditAssignments(log: LoggedAssignment[]): LoggedAssignment[] {
  return log.filter((a) => a.excluded === null
    && (a.sequence === null || a.arm !== armFor(a.seed, a.userId, a.experiment, a.sequence)));
}
