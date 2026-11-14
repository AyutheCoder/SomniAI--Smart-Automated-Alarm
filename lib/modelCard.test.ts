import { describe, expect, it } from "vitest";
import { OVERSLEEP_ALERT, WAKE_RELIABLE, predictSleep } from "./aiClient";
import { cardLines, inputName, MODEL_CARD } from "./modelCard";
import { forbiddenWordingIn } from "./predictionCopy";

describe("the model card in the app (prompt 5.2)", () => {
  it("is the shipped models' card: real people, credited, never the synthetic panel", () => {
    expect(MODEL_CARD.trainedOn).toMatchObject({ name: "LifeSnaps", participants: 69, nights: 3551, licence: "CC BY 4.0" });
    const text = cardLines().flatMap((s) => s.lines).join(" ");
    expect(text).toContain("69 real people over 3,551 nights with a Fitbit Sense: the LifeSnaps study");
    expect(text).toContain("Scientific Data 9:663");
    expect(text).not.toMatch(/synthetic|simulated|0\.785|340 /i);
  });

  it("says each figure as measured on held-out people", () => {
    const [, how] = cardLines();
    expect(how.lines[0]).toBe("Sleep length: off by 1.0 h on a typical night, against 1.2 h for guessing everyone's average. They explain about 19% of why nights differ.");
    expect(how.lines[1]).toBe("Waking close to your usual time: given one regular night and one off-schedule night, they rank them the right way round "
      + "66% of the time, where a coin toss manages 50%. As a yes or no they're right on 72% of nights, a little under the 75% you'd get by always saying \"regular\".");
    expect(how.lines[2]).toBe("Figures are averages over 8 different groups of held-out people, and they move a lot between groups.");
  });

  it("names what the models use and what can't change a prediction", () => {
    const [what] = cardLines();
    expect(what.lines[1]).toBe("They use your chronotype, bedtime, exercise, resting heart rate, steps, sleep consistency, sleep debt. "
      + "Anything you haven't given takes the study's typical value.");
    expect(what.lines[2]).toMatch(/^They can't use your age, screen time before bed, caffeine, stress, room noise, room temperature, snoozes, how fast you answer the alarm:/);
    expect(inputName("unknown_thing")).toBe("unknown_thing");
  });

  it("uses no wording the prediction copy forbids", () => {
    expect(forbiddenWordingIn(cardLines().flatMap((s) => [s.heading, ...s.lines]).join(" "))).toEqual([]);
  });

  it("the fallback words its advice by the shipped model's thresholds, as the AI Brain does", () => {
    expect(OVERSLEEP_ALERT).toBe(MODEL_CARD.thresholds.offScheduleAlert);
    expect(WAKE_RELIABLE).toBe(MODEL_CARD.thresholds.regularHigh);
  });

  it("consistency is measured, never made up, in the fallback too", async () => {
    // No AI Brain configured in tests: the fallback rules answer.
    const known = await predictSleep({ sleep_consistency: 71.26 });
    expect(known.source).toBe("fallback");
    expect(known.data.wakeupConsistency).toBe(71.3);
    expect((await predictSleep({})).data.wakeupConsistency).toBeNull();
  });
});
