import { describe, expect, it } from "vitest";
import { buildEscalationPlan, deriveEscalationProfile } from "./escalation";
import {
  buildMorningReport,
  levelsForProfile,
  planVerdict,
  reportKind,
  reportLines,
  stageFor,
  streakOf,
  type RingRecord,
} from "./morningReport";

const TZ = "Asia/Kolkata";
const ladder = buildEscalationPlan("adaptive");
const ringAt = new Date("2026-11-14T01:30:00.000Z"); // 07:00 in Kolkata
const noCheck = { required: false, passed: null, seconds: null, steps: null, score: null, threshold: null };
const learning = deriveEscalationProfile({ effectiveLevels: [] });

function ring(over: Partial<RingRecord>): RingRecord {
  return {
    alarmId: "a1", label: "Work", ringAt, outcome: "woke", level: 1, levelLabel: "Normal alarm", stage: "ramp",
    rang: true, endedAt: new Date(ringAt.getTime() + 20_000), verification: noCheck, ...over,
  };
}
const plan = { bedtime: new Date("2026-11-13T17:00:00.000Z"), wakeAt: ringAt }; // bed by 22:30

describe("the morning report", () => {
  it("a gentle wake: up at the first level, check passed, plan kept, streak growing", () => {
    const r = buildMorningReport(
      ring({ verification: { required: true, passed: true, seconds: 33.4, steps: 3, score: 96, threshold: 70 } }),
      planVerdict(plan, new Date("2026-11-13T16:50:00.000Z")),
      ["woke", "woke", "missed", "woke"],
      learning,
    );
    expect(r).toMatchObject({ kind: "gentle", outcome: "woke", level: 1, streak: { count: 2, best: 2 }, plan: { status: "followed" } });
    expect(reportLines(r, TZ)).toEqual({
      title: "Work, 07:00",
      stage: "Gentle wake: you were up at level 1 of 5, Normal alarm.",
      verification: "Wake check passed in 33 s (3 answers).",
      plan: "Last night's plan: bed by 22:30. You were in bed at 22:20: plan kept.",
      streak: "Streak: 2 alarms answered in a row.",
      profile: "Escalation profile: learning, 0 of the 3 alarms it needs before it changes your ladder.",
    });
  });

  it("a fully escalated wake: it took the backups, the check took over a minute, bed was late", () => {
    const r = buildMorningReport(
      ring({ level: 5, levelLabel: "Trying backups", stage: "challenge", verification: { required: true, passed: true, seconds: 74, steps: 3, score: 71, threshold: 70 } }),
      planVerdict(plan, new Date("2026-11-13T18:10:00.000Z")),
      ["woke", "woke", "woke", "woke", "missed", "woke"],
      deriveEscalationProfile({ effectiveLevels: [5, 4, 4, 5] }),
    );
    expect(r).toMatchObject({ kind: "full", level: 5, streak: { count: 4, best: 4 }, plan: { status: "not_followed", lateMinutes: 70 } });
    const lines = reportLines(r, TZ);
    expect(lines.stage).toBe("Fully escalated: it took level 5 of 5, Trying backups.");
    expect(lines.verification).toBe("Wake check passed in 1 min 14 s (3 answers).");
    expect(lines.plan).toBe("Last night's plan: bed by 22:30. You were in bed at 23:40, 70 minutes late.");
    expect(lines.streak).toBe("Streak: 4 alarms answered in a row.");
    expect(lines.profile).toBe("Escalation profile, from 4 alarms: you usually wake at level 5, so your alarms now climb sooner.");
  });

  it("a missed alarm: nothing stopped it, no check, the streak resets, the plan can't be judged", () => {
    const r = buildMorningReport(
      ring({ outcome: "missed", level: 5, levelLabel: "Trying backups", stage: "challenge", endedAt: new Date(ringAt.getTime() + 20 * 60_000) }),
      planVerdict(plan, null),
      ["missed", "woke", "woke", "woke"],
      learning,
    );
    expect(r).toMatchObject({ kind: "missed", outcome: "missed", streak: { count: 0, best: 3 }, plan: { status: "unknown" } });
    expect(reportLines(r, TZ)).toMatchObject({
      stage: "Missed: nothing stopped it. It rang until 07:20 and reached level 5 of 5, Trying backups.",
      verification: "No wake check: the alarm wasn't answered.",
      plan: "Last night's plan: bed by 22:30. No bedtime was recorded, so SomniAI can't tell whether you kept to it.",
      streak: "Streak reset: this alarm wasn't answered. Your best is 3 alarms in a row.",
    });
  });

  it("a missed alarm that never rang says so, and has no level", () => {
    const r = buildMorningReport(ring({ outcome: "missed", rang: false, level: null, levelLabel: null, stage: null }), planVerdict(null, null), ["missed"], learning);
    const lines = reportLines(r, TZ);
    expect(lines.stage).toBe("Missed: it didn't ring on any device that reported back.");
    expect(lines.plan).toBe("No plan was set for last night.");
    expect(lines.streak).toBe("Streak reset: this alarm wasn't answered.");
  });

  it("an escalated wake, a failed check, and no check at all", () => {
    const failed = buildMorningReport(
      ring({ level: 3, levelLabel: "Continuous vibration", stage: "vibration", verification: { required: true, passed: false, seconds: 50, steps: 3, score: 54, threshold: 70 } }),
      planVerdict(null, null), ["woke"], learning,
    );
    expect(failed.kind).toBe("escalated");
    expect(reportLines(failed, TZ).stage).toBe("Escalated: you were up at level 3 of 5, Continuous vibration (escalating).");
    expect(reportLines(failed, TZ).verification).toBe("Wake check not passed (score 54, needed 70) after 50 s.");
    expect(reportLines(buildMorningReport(ring({}), planVerdict(null, null), ["woke"], learning), TZ).verification).toBe("No wake check on this alarm.");
    const lost = ring({ verification: { ...noCheck, required: true } });
    expect(reportLines(buildMorningReport(lost, planVerdict(null, null), ["woke"], learning), TZ).verification)
      .toBe("The wake check's result never reached the server.");
  });

  it("names levels from the alarm's own ladder", () => {
    expect(stageFor(2, ladder)).toEqual({ label: "Increased volume", stage: "ramp" });
    expect(stageFor(5, ladder)).toEqual({ label: "Trying backups", stage: "challenge" });
    expect(stageFor(4, [])).toEqual({ label: "Level 4", stage: "challenge" });
    expect([1, 2, 3, 4, 5].map((l) => reportKind("woke", l))).toEqual(["gentle", "gentle", "escalated", "escalated", "full"]);
    expect(reportKind("missed", 1)).toBe("missed");
  });

  it("counts a plan kept within the grace, and late past it", () => {
    expect(planVerdict(plan, new Date(plan.bedtime.getTime() + 15 * 60_000)).status).toBe("followed");
    expect(planVerdict(plan, new Date(plan.bedtime.getTime() + 16 * 60_000))).toMatchObject({ status: "not_followed", lateMinutes: 16 });
  });

  it("streaks count answered alarms back from the newest", () => {
    expect(streakOf([])).toEqual({ count: 0, best: 0 });
    expect(streakOf(["woke"])).toEqual({ count: 1, best: 1 });
    expect(streakOf(["woke", "missed", "woke", "woke", "woke"])).toEqual({ count: 1, best: 3 });
  });
});

describe("what the escalation profile learns from the reports", () => {
  it("each ring's level; a missed ring as the whole ladder; one that never rang not at all", () => {
    expect(levelsForProfile([
      { outcome: "woke", level: 2, rang: true },
      { outcome: "missed", level: 3, rang: true },
      { outcome: "missed", level: null, rang: false },
      { outcome: "woke", level: null, rang: true },
    ])).toEqual([2, 5, 1]);
  });

  it("a habitually gentle waker gets a gentler ladder; misses pull it back", () => {
    const gentle = deriveEscalationProfile({ effectiveLevels: levelsForProfile(Array(4).fill({ outcome: "woke", level: 1, rang: true })) });
    expect(gentle).toMatchObject({ typicalLevel: 1, paceFactor: 1.25 });
    const missing = deriveEscalationProfile({ effectiveLevels: levelsForProfile([
      ...Array(3).fill({ outcome: "missed", level: 4, rang: true }),
      { outcome: "woke", level: 1, rang: true },
    ]) });
    expect(missing).toMatchObject({ typicalLevel: 5, reliableLevel: 5, paceFactor: 0.6 });
  });
});
