import { describe, it, expect } from "vitest";
import {
  taskImportance,
  proposeAlarmsFromTasks,
  type SchedulableTask,
  type SchedulerProfile,
  type SchedulerPrediction,
  type SkippedTask,
} from "./scheduler";

/**
 * RISK_BUMP_THRESHOLD in scheduler.ts. Restated so that moving it fails these
 * tests rather than silently changing how many alarms get hardened - the reason
 * it was raised from 0.5 in the first place.
 */
const RISK_BUMP_THRESHOLD = 0.65;

const task = (over: Partial<SchedulableTask> = {}): SchedulableTask => ({
  _id: "t1",
  title: "Final exam",
  priority: "medium",
  completed: false,
  dueDate: "2026-01-10",
  dueTime: "09:00",
  ...over,
});

const profile = (over: Partial<SchedulerProfile> = {}): SchedulerProfile => ({
  chronotype: "intermediate",
  sleepGoalHours: 8,
  preferredWakeWindowMin: 30,
  defaultWakeStrategy: "gentle",
  verificationRequired: false,
  ...over,
});

const prediction = (over: Partial<SchedulerPrediction> = {}): SchedulerPrediction => ({
  predictedSleepDuration: 7,
  wakeupConsistency: 0.8,
  oversleepProbability: 0.2,
  wakeSuccessProbability: 0.7,
  ...over,
});

/** Midnight before the task's due date, so a morning wake is always schedulable. */
const NOW = new Date(2026, 0, 10, 0, 0, 0);

const planFor = (
  taskOver: Partial<SchedulableTask> = {},
  predictionOver: Partial<SchedulerPrediction> = {},
  profileOver: Partial<SchedulerProfile> = {},
) => {
  const plans = proposeAlarmsFromTasks(
    [task(taskOver)],
    profile(profileOver),
    prediction(predictionOver),
    [],
    { now: NOW },
  );
  expect(plans).toHaveLength(1);
  return plans[0];
};

describe("task importance scoring", () => {
  it("maps a bare priority straight through to its weight", () => {
    expect(taskImportance(task({ priority: "low" })).score).toBeCloseTo(0.25);
    expect(taskImportance(task({ priority: "medium" })).score).toBeCloseTo(0.5);
    expect(taskImportance(task({ priority: "high" })).score).toBeCloseTo(0.75);
    expect(taskImportance(task({ priority: "critical" })).score).toBeCloseTo(1);
  });

  it("labels each band", () => {
    expect(taskImportance(task({ priority: "low" })).label).toBe("low");
    expect(taskImportance(task({ priority: "medium" })).label).toBe("medium");
    expect(taskImportance(task({ priority: "high" })).label).toBe("high");
    expect(taskImportance(task({ priority: "critical" })).label).toBe("critical");
  });

  it("lets the AI raise a priority the user under-set", () => {
    const result = taskImportance(task({ priority: "low", aiPriority: "critical" }));
    expect(result.score).toBeCloseTo(1);
    expect(result.label).toBe("critical");
  });

  it("never lets the AI talk a priority down", () => {
    // Math.max of the two weights: the user's own judgement is a floor.
    const result = taskImportance(task({ priority: "critical", aiPriority: "low" }));
    expect(result.score).toBeCloseTo(1);
    expect(result.label).toBe("critical");
  });

  it("blends a semantic importance score in at 40 percent", () => {
    // weight 0.5 * 0.6 + 1.0 * 0.4
    const result = taskImportance(task({ priority: "medium", importanceScore: 100 }));
    expect(result.score).toBeCloseTo(0.7);
    expect(result.label).toBe("high");
  });

  it("clamps an out-of-range importance score", () => {
    expect(taskImportance(task({ priority: "medium", importanceScore: 500 })).score).toBeCloseTo(0.7);
    expect(taskImportance(task({ priority: "medium", importanceScore: -80 })).score).toBeCloseTo(0.3);
  });

  it("floors anything phrased as unmissable", () => {
    // A trivially-prioritised task the user described as unmissable still gets
    // treated as high importance.
    const result = taskImportance(task({ priority: "low", intent: "must-not-miss" }));
    expect(result.score).toBeCloseTo(0.75);
    expect(result.label).toBe("high");
  });

  it("does not let must-not-miss pull a higher score down", () => {
    const result = taskImportance(task({ priority: "critical", intent: "must-not-miss" }));
    expect(result.score).toBeCloseTo(1);
  });

  it("caps anything phrased casually", () => {
    const result = taskImportance(task({ priority: "critical", intent: "casual" }));
    expect(result.score).toBeCloseTo(0.5);
    expect(result.label).toBe("medium");
  });

  it("separates the label bands at their boundaries", () => {
    const at = (importanceScore: number) =>
      taskImportance(task({ priority: "medium", importanceScore })).label;
    // score = 0.3 + importanceScore/100 * 0.4
    expect(at(37.5)).toBe("medium"); // exactly 0.45
    expect(at(37)).toBe("low");
    expect(at(100)).toBe("high"); // exactly 0.70
  });
});

describe("the oversleep risk bump", () => {
  it("leaves an alarm alone below the threshold", () => {
    const plan = planFor({ priority: "critical" }, { oversleepProbability: 0.2 });
    expect(plan.intensity).toBe(90);
    expect(plan.minConfidence).toBe(85);
    expect(plan.wakeStrategy).toBe("aggressive");
    expect(plan.verificationMethods).toEqual(["math", "typing"]);
  });

  it("does not fire exactly at the threshold", () => {
    // The comparison is strictly greater-than; the boundary itself is quiet.
    const plan = planFor({ priority: "critical" }, { oversleepProbability: RISK_BUMP_THRESHOLD });
    expect(plan.intensity).toBe(90);
    expect(plan.minConfidence).toBe(85);
  });

  it("hardens an alarm just past the threshold", () => {
    const plan = planFor(
      { priority: "critical" },
      { oversleepProbability: RISK_BUMP_THRESHOLD + 0.01 },
    );
    expect(plan.intensity).toBe(100);
    expect(plan.minConfidence).toBe(90);
    expect(plan.verificationRequired).toBe(true);
  });

  it("forces verification onto an alarm that would not have required it", () => {
    // Low importance and a profile that does not ask for verification: without
    // the bump this alarm is a tap-to-dismiss.
    const relaxed = planFor(
      { priority: "low", dueTime: "08:00" },
      { oversleepProbability: 0.2 },
      { verificationRequired: false },
    );
    expect(relaxed.verificationRequired).toBe(false);
    expect(relaxed.verificationMethods).toEqual(["tap"]);

    const hardened = planFor(
      { priority: "low", dueTime: "08:00" },
      { oversleepProbability: 0.9 },
      { verificationRequired: false },
    );
    expect(hardened.verificationRequired).toBe(true);
    expect(hardened.verificationMethods).toEqual(["tap", "math"]);
    expect(hardened.intensity).toBe(60);
    expect(hardened.minConfidence).toBe(65);
  });

  it("upgrades a gentle strategy but leaves a firmer one alone", () => {
    const fromGentle = planFor(
      { priority: "low", dueTime: "08:00" },
      { oversleepProbability: 0.9 },
      { defaultWakeStrategy: "gentle" },
    );
    expect(fromGentle.wakeStrategy).toBe("adaptive");

    const alreadyAggressive = planFor(
      { priority: "critical" },
      { oversleepProbability: 0.9 },
    );
    expect(alreadyAggressive.wakeStrategy).toBe("aggressive");
  });

  it("does not add a second math challenge when one is already there", () => {
    const plan = planFor({ priority: "high" }, { oversleepProbability: 0.9 });
    expect(plan.verificationMethods).toEqual(["math"]);
  });

  it("explains itself when it fires", () => {
    const plan = planFor({ priority: "critical" }, { oversleepProbability: 0.9 });
    expect(plan.rationale).toContain("90%");
    expect(plan.rationale.toLowerCase()).toContain("oversleep risk");
  });

  it("says nothing about a bump that did not happen", () => {
    const plan = planFor({ priority: "critical" }, { oversleepProbability: 0.2 });
    expect(plan.rationale.toLowerCase()).not.toContain("intensity raised");
  });
});

describe("scheduling guards", () => {
  it("reserves a longer prep buffer for a higher-stakes task", () => {
    const low = planFor({ priority: "low", dueTime: "08:00" });
    const critical = planFor({ priority: "critical", dueTime: "08:00" });
    expect(new Date(critical.scheduledTime).getTime()).toBeLessThan(
      new Date(low.scheduledTime).getTime(),
    );
  });

  it("adds extra lead time for categories that need it", () => {
    const plain = planFor({ priority: "medium", dueTime: "09:00" });
    const flight = planFor({ priority: "medium", dueTime: "09:00", category: "flight" });
    const gap =
      new Date(plain.scheduledTime).getTime() - new Date(flight.scheduledTime).getTime();
    expect(gap).toBe(30 * 60000);
  });

  it("skips an unimportant afternoon task but keeps an important one", () => {
    const skipped: SkippedTask[] = [];
    const plans = proposeAlarmsFromTasks(
      [task({ _id: "afternoon", priority: "low", dueTime: "15:00" })],
      profile(),
      prediction(),
      [],
      { now: NOW, skipped },
    );
    expect(plans).toHaveLength(0);
    expect(skipped[0].reason).toBe("not-morning-and-low-priority");

    const important = proposeAlarmsFromTasks(
      [task({ _id: "afternoon", priority: "critical", dueTime: "15:00" })],
      profile(),
      prediction(),
      [],
      { now: NOW },
    );
    expect(important).toHaveLength(1);
  });

  it("does not schedule a second alarm for a task that already has one", () => {
    const skipped: SkippedTask[] = [];
    const plans = proposeAlarmsFromTasks(
      [task({ _id: "t1" })],
      profile(),
      prediction(),
      [{ scheduledTime: new Date(2026, 0, 10, 7, 45).toISOString(), enabled: true, linkedTaskId: "t1" }],
      { now: NOW, skipped },
    );
    expect(plans).toHaveLength(0);
    expect(skipped[0].reason).toBe("already-has-alarm");
  });

  it("ignores a disabled alarm when checking for collisions", () => {
    const plans = proposeAlarmsFromTasks(
      [task({ _id: "t1" })],
      profile(),
      prediction(),
      [{ scheduledTime: new Date(2026, 0, 10, 7, 45).toISOString(), enabled: false }],
      { now: NOW },
    );
    expect(plans).toHaveLength(1);
  });

  it("records why a task with no due date was passed over", () => {
    const skipped: SkippedTask[] = [];
    proposeAlarmsFromTasks(
      [task({ dueDate: undefined })],
      profile(),
      prediction(),
      [],
      { now: NOW, skipped },
    );
    expect(skipped).toEqual([{ taskId: "t1", title: "Final exam", reason: "no-due-date" }]);
  });

  it("will not schedule a wake that has effectively already passed", () => {
    const skipped: SkippedTask[] = [];
    const plans = proposeAlarmsFromTasks(
      [task({ dueTime: "09:00" })],
      profile(),
      prediction(),
      [],
      // Now sits after the wake time the buffer would ask for.
      { now: new Date(2026, 0, 10, 8, 30), skipped },
    );
    expect(plans).toHaveLength(0);
    expect(skipped[0].reason).toBe("too-soon");
  });

  it("ignores completed tasks entirely", () => {
    const skipped: SkippedTask[] = [];
    const plans = proposeAlarmsFromTasks(
      [task({ completed: true })],
      profile(),
      prediction(),
      [],
      { now: NOW, skipped },
    );
    expect(plans).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});
