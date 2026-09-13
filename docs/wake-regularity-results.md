# Wake-regularity model: real cohorts versus synthetic

Training the classifier on the step-7 proxy label (wake-time regularity), on two
independent real cohorts, against a majority-class baseline and the synthetic
panel.

**Headline: there is a real, replicated signal — but it does not beat
majority-class accuracy by a margin worth defending. The step-9 off-ramp is
triggered and the paper's framing has to change.**

Code: `ai-brain/training/train_real.py`. Tests: `tests/test_train_real.py`.

---

## Results

Means over 8 grouped splits (LifeSnaps) and 5 (PMData). `class_weight="balanced"`.

| | AUC | Balanced acc. | Accuracy | Majority baseline | Δ accuracy |
| --- | --- | --- | --- | --- | --- |
| **Synthetic panel** | **0.761** | 0.700 | 0.699 | 0.515 | **+18.4 pts** |
| **LifeSnaps** | 0.660 | 0.615 | 0.716 | 0.748 | **−3.2 pts** |
| **PMData** | 0.675 | 0.594 | 0.683 | 0.685 | −0.2 pts |

Without class weighting, LifeSnaps accuracy rises to 0.759 against a 0.748
majority baseline — **+1.0 point** — with AUC unchanged at 0.663. So the
weighting is not what costs the accuracy; the label is simply hard. The weighted
model trades raw accuracy for minority-class recall, which is why balanced
accuracy and AUC are the honest headline here.

### The signal is real but weak

- AUC sits above chance in **13 of 13 splits across both cohorts**, mean 0.660
  and 0.675. Balanced accuracy 0.615 and 0.594 against a 0.500 chance level.
- It **replicates on an independent cohort**, which matters — PMData's AUC is
  marginally *higher* than LifeSnaps'.
- But it is unstable: one LifeSnaps split lands at AUC 0.518, indistinguishable
  from chance.
- And +1.0 accuracy point over majority-class is not a defensible headline.

### Why the synthetic comparison flatters itself

The synthetic label is nearly balanced (majority 0.515), so "+18.4 points over
majority" is easy there and impossible on a 75/25 real label. **AUC is the only
fair comparison across the two: 0.761 synthetic against 0.660 and 0.675 real.**

That gap is real but far smaller than the sleep-duration gap (R² 0.70 → 0.19).
Wake-time regularity is the more learnable of the two targets from wearable
features — it is simply not very learnable in absolute terms.

## Leakage guards

Beyond the participant-level splits, `sleep_duration_hours` is refused as a
predictor for this target: combined with `bedtime_hour` it reconstructs wake
time and therefore the label. `wake_time_hour`, `wake_deviation_hours` and
`habitual_wake_hour` are refused for the same reason. Each has a test.

## What this means

Three consecutive steps now point the same way:

| Step | Finding |
| --- | --- |
| 7 | The wake-success label has no association with self-reported wellbeing; it measures schedule regularity |
| 8 | Sleep duration: R² 0.19 real against 0.70 synthetic; negative on PMData |
| 9 | Wake regularity: AUC 0.66 real against 0.76 synthetic; +1.0 point over majority |

**The consistent story is that wrist-wearable features predict sleep outcomes far
more weakly than a synthetic panel implies.** That is not a failed project. It is
a finding, it is replicated across two cohorts, and training sleep models on
simulated data is common enough that the finding is worth publishing.

What it forecloses is any claim that the planner produces *reliable* bedtime
recommendations. What it opens is a more defensible claim: a planner built on a
model this weak should refuse to promise, and this one does — the infeasibility
verdict stops being a fallback and becomes the point.

See `BUILD_PLAN.md` for the framing decision this forces before step 10.
