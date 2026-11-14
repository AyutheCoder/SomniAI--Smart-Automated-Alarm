// The AI Brain's model card, as the app shows it (prompt 5.2). Read from the
// file the service ships (ai-brain/models/real/model_card.json, written by
// training/train_shipped.py), so what the app says about the models is what
// was measured, never a number typed in here. The models are trained on real
// people (LifeSnaps), replacing ones trained on a synthetic panel, whose
// metrics described simulated people and are no longer shown.

import card from "../ai-brain/models/real/model_card.json";

interface Summary { mean: number; ci_low: number; ci_high: number; n_splits: number }

export interface ModelCard {
  trainedOn: { name: string; participants: number; nights: number; device: string; citation: string; source: string; licence: string };
  features: string[];
  inputsNotUsed: { feature: string; why: string }[];
  models: {
    sleep_duration: { trainingParticipants: number; evaluation: { mae: Summary; r2: Summary; baselineMeanMae: number } };
    wake_regularity: { trainingParticipants: number; evaluation: { roc_auc: Summary; accuracy: Summary; majorityBaselineAccuracy: number } };
  };
  thresholds: { offScheduleAlert: number; regularHigh: number };
  trainedAt: string;
}

export const MODEL_CARD = card as unknown as ModelCard;

/** The app's words for the model's inputs. */
const INPUT_NAME: Record<string, string> = {
  age: "age",
  chronotype_code: "chronotype",
  bedtime_hour: "bedtime",
  screen_minutes_before_bed: "screen time before bed",
  caffeine_mg: "caffeine",
  exercise_minutes: "exercise",
  stress_level: "stress",
  ambient_noise_db: "room noise",
  room_temp_c: "room temperature",
  resting_hr: "resting heart rate",
  steps: "steps",
  snooze_count: "snoozes",
  alarm_response_ms: "how fast you answer the alarm",
  sleep_consistency: "sleep consistency",
  sleep_debt_hours: "sleep debt",
};

export const inputName = (f: string) => INPUT_NAME[f] ?? f;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const hours = (x: number) => `${x.toFixed(1)} h`;

/** The card in plain sentences, each one a measured figure. No word the prediction copy forbids. */
export function cardLines(c: ModelCard = MODEL_CARD): { heading: string; lines: string[] }[] {
  const sd = c.models.sleep_duration.evaluation;
  const wr = c.models.wake_regularity.evaluation;
  const t = c.trainedOn;
  return [
    {
      heading: "What they learned from",
      lines: [
        `${t.participants} real people over ${t.nights.toLocaleString("en")} nights with a ${t.device}: the ${t.name} study (${t.citation} ${t.licence}).`,
        `They use your ${c.features.map(inputName).join(", ")}. Anything you haven't given takes the study's typical value.`,
        `They can't use your ${c.inputsNotUsed.map((x) => inputName(x.feature)).join(", ")}: the study didn't record them (or not usably), so these can't change a prediction.`,
      ],
    },
    {
      heading: "How well they do, on people they never saw",
      lines: [
        `Sleep length: off by ${hours(sd.mae.mean)} on a typical night, against ${hours(sd.baselineMeanMae)} for guessing everyone's average. `
          + `They explain about ${pct(sd.r2.mean)} of why nights differ.`,
        `Waking close to your usual time: given one regular night and one off-schedule night, they rank them the right way round `
          + `${pct(wr.roc_auc.mean)} of the time, where a coin toss manages 50%. As a yes or no they're right on ${pct(wr.accuracy.mean)} `
          + `of nights, a little under the ${pct(wr.majorityBaselineAccuracy)} you'd get by always saying "regular".`,
        `Figures are averages over ${sd.mae.n_splits} different groups of held-out people, and they move a lot between groups.`,
      ],
    },
  ];
}
