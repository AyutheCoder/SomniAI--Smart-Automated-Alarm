"""Reliability-targeted wake planning: run the sleep model backwards.

Everything else in this service answers "given tonight, how likely is a
successful wake?". That is the wrong direction for the question a user actually
has, which is a requirement, not a forecast:

    "I must be up at 05:40 for a flight, and I cannot miss it."

This module inverts that. Given a required wake time and a target reliability,
it searches the controllable inputs for the *latest* bedtime that still clears
the target, and reports which other levers buy the most probability if it
cannot be cleared. Two things fall out that a forward prediction cannot give:

  * a deadline the user can act on tonight ("asleep by 22:50"), rather than a
    probability they must interpret themselves, and
  * an explicit infeasibility verdict - if no admissible bedtime reaches 95%,
    the honest answer is "not at this reliability", plus the smallest set of
    changes that would make it reachable.

Only inputs a person can actually change before bed are treated as controllable.
Age, chronotype and resting heart rate are constraints, not levers.
"""

from __future__ import annotations

from typing import Any

from feature_spec import FEATURE_DEFAULTS
from predict import predict_sleep, predict_wake_success, predict_wake_success_batch

# Levers the user can still move tonight: (feature, direction, floor, ceiling,
# step, human label). `direction` is the sign of the change that should help.
CONTROLLABLE: list[tuple[str, int, float, float, float, str]] = [
    ("bedtime_hour", -1, 20.0, 26.0, 0.25, "Go to bed earlier"),
    ("screen_minutes_before_bed", -1, 0.0, 180.0, 15.0, "Cut screen time before bed"),
    ("caffeine_mg", -1, 0.0, 400.0, 40.0, "Cut afternoon caffeine"),
    ("ambient_noise_db", -1, 20.0, 70.0, 5.0, "Quieten the room"),
    ("room_temp_c", 0, 14.0, 30.0, 1.0, "Move room temperature toward 20.5C"),
    ("stress_level", -1, 0.0, 100.0, 10.0, "Wind down / lower stress"),
    ("exercise_minutes", +1, 0.0, 120.0, 20.0, "Get some daytime exercise"),
]

BEDTIME_MIN = 20.0
BEDTIME_MAX = 26.0
BEDTIME_STEP = 0.25          # 15-minute resolution
IDEAL_ROOM_TEMP = 20.5


def _reliability(features: dict) -> float:
    """P(wake succeeds) for a candidate feature vector."""
    return float(predict_wake_success(features)["wakeSuccessProbability"])


def _with(features: dict, name: str, value: float) -> dict:
    out = dict(features)
    out[name] = value
    return out


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _hhmm(hour_float: float) -> str:
    """23.75 -> '23:45'; 25.5 -> '01:30' (next day)."""
    h = hour_float % 24.0
    hours = int(h)
    minutes = int(round((h - hours) * 60))
    if minutes == 60:
        hours, minutes = (hours + 1) % 24, 0
    return f"{hours:02d}:{minutes:02d}"


def _latest_feasible_bedtime(
    features: dict, target: float
) -> tuple[float | None, float, list[dict]]:
    """Scan bedtimes late->early for the last one that still clears `target`.

    Returns (bedtime or None, best reliability seen, the full curve). Scanning
    rather than optimising is deliberate: the forest's response is a step
    function, so gradient methods have nothing to follow, the admissible range is
    only 24 points wide, and the whole curve is worth returning for the UI.
    """
    steps = int(round((BEDTIME_MAX - BEDTIME_MIN) / BEDTIME_STEP)) + 1
    candidates = [BEDTIME_MAX - i * BEDTIME_STEP for i in range(steps)]
    # One matrix through the forest rather than 25 separate traversals.
    scores = predict_wake_success_batch(
        [_with(features, "bedtime_hour", b) for b in candidates]
    )

    curve: list[dict] = []
    best_rel = 0.0
    feasible: float | None = None
    for bedtime, rel in zip(candidates, scores):
        curve.append({"bedtimeHour": round(bedtime, 2), "reliability": round(rel, 4)})
        best_rel = max(best_rel, rel)
        if feasible is None and rel >= target:
            feasible = bedtime

    curve.reverse()  # chronological for plotting
    return feasible, best_rel, curve


def _rank_levers(features: dict, target: float, baseline: float) -> list[dict]:
    """One-at-a-time counterfactual: how much does each lever buy on its own?

    Each controllable input is pushed to its most helpful admissible value with
    everything else held fixed, so the reported gain is attributable to that one
    change - which is what makes it a usable instruction rather than a
    correlation.
    """
    cands: list[tuple[str, float, float, str]] = []
    for name, direction, lo, hi, step, label in CONTROLLABLE:
        current = float(features.get(name, FEATURE_DEFAULTS[name]))
        if direction == 0:  # target a set-point rather than an extreme
            candidate = IDEAL_ROOM_TEMP
        else:
            # A realistic single-night move, not the theoretical extreme.
            candidate = _clamp(current + direction * step * 3, lo, hi)
        if abs(candidate - current) < 1e-9:
            continue
        cands.append((name, current, candidate, label))

    scores = predict_wake_success_batch(
        [_with(features, name, cand) for name, _, cand, _ in cands]
    )

    levers: list[dict] = []
    for (name, current, candidate, label), scored in zip(cands, scores):
        gain = scored - baseline
        if gain <= 0.001:
            continue

        levers.append({
            "feature": name,
            "label": label,
            "from": round(current, 2),
            "to": round(candidate, 2),
            "reliabilityGain": round(gain, 4),
            "closesGap": gain >= (target - baseline),
        })

    levers.sort(key=lambda l: l["reliabilityGain"], reverse=True)
    return levers


# Inputs that reflect accumulated habit rather than tonight's choices. They
# cannot be changed before bed, but they are often what actually caps a user's
# reliability - so when a plan is infeasible, these explain why.
HABIT_FEATURES: list[tuple[str, float, str]] = [
    ("sleep_consistency", 85.0, "Keep bedtime within +/-30 min"),
    ("snooze_count", 0.0, "Break the snooze habit"),
    ("alarm_response_ms", 5000.0, "Get up on the first alarm"),
    ("sleep_debt_hours", 0.0, "Clear accumulated sleep debt"),
]


def _habit_constraints(features: dict, baseline: float) -> list[dict]:
    """Which *uncontrollable-tonight* factors are capping reliability?

    Answers "why am I stuck at 6%?" when no combination of tonight's levers
    reaches the target. These take weeks of behaviour change, so they are
    reported separately from the actionable plan rather than mixed into it.
    """
    cands: list[tuple[str, float, float, str]] = []
    for name, healthy, label in HABIT_FEATURES:
        current = float(features.get(name, FEATURE_DEFAULTS[name]))
        if abs(current - healthy) < 1e-9:
            continue
        cands.append((name, current, healthy, label))

    scores = predict_wake_success_batch(
        [_with(features, name, healthy) for name, _, healthy, _ in cands]
    )

    out: list[dict] = []
    for (name, current, healthy, label), scored in zip(cands, scores):
        gain = scored - baseline
        if gain <= 0.01:
            continue
        out.append({
            "feature": name,
            "label": label,
            "from": round(current, 2),
            "to": round(healthy, 2),
            "reliabilityGain": round(gain, 4),
            "horizon": "weeks",
        })
    out.sort(key=lambda h: h["reliabilityGain"], reverse=True)
    return out


def _optimize_plan(
    features: dict, target: float, max_rounds: int = 3
) -> tuple[dict, float, list[dict]]:
    """Greedy coordinate ascent over every lever at once.

    A single lever rarely moves a bad night much; the combination is what
    matters. Each round takes the biggest available improvement, then re-scores,
    which lets later choices account for what earlier ones already bought
    (bedtime and caffeine are partly redundant, so counting both gains
    separately would overstate the plan).

    Stops as soon as the target is met, so the plan asks for the fewest changes
    that suffice rather than every change available.
    """
    current = dict(features)
    steps: list[dict] = []
    rel = _reliability(current)

    for _ in range(max_rounds):
        if rel >= target:
            break

        moves: list[tuple[str, float, str, float]] = []
        for name, direction, lo, hi, step, label in CONTROLLABLE:
            value = float(current.get(name, FEATURE_DEFAULTS[name]))
            candidate = (
                IDEAL_ROOM_TEMP
                if direction == 0
                else _clamp(value + direction * step * 3, lo, hi)
            )
            if abs(candidate - value) < 1e-9:
                continue
            moves.append((name, candidate, label, value))

        if not moves:
            break

        gains = predict_wake_success_batch(
            [_with(current, name, cand) for name, cand, _, _ in moves]
        )
        best_i = max(range(len(moves)), key=lambda i: gains[i])
        gain = gains[best_i] - rel
        if gain <= 0.002:
            break

        name, candidate, label, value = moves[best_i]
        # Re-picking the same lever is a further move along it, not a second
        # instruction - fold it into the existing step so the plan doesn't read
        # "go to bed earlier, go to bed earlier".
        existing = next((s for s in steps if s["feature"] == name), None)
        if existing:
            existing["to"] = round(candidate, 2)
            existing["reliabilityGain"] = round(existing["reliabilityGain"] + gain, 4)
        else:
            steps.append({
                "feature": name,
                "label": label,
                "from": round(value, 2),
                "to": round(candidate, 2),
                "reliabilityGain": round(gain, 4),
            })
        current = _with(current, name, candidate)
        rel = gains[best_i]

    return current, _reliability(current), steps


def plan_wake(payload: dict | None) -> dict[str, Any]:
    """Invert the model against a hard wake requirement.

    payload: {features, requiredReliability, wakeTime?, minSleepHours?}
    """
    payload = payload or {}
    features = payload.get("features") or {}
    # Pydantic's model_dump() emits unset optionals as explicit None, so a plain
    # dict.get(key, default) hands back None rather than the default.
    target = payload.get("requiredReliability")
    target = _clamp(float(target) if target is not None else 0.9, 0.05, 0.99)
    min_sleep = payload.get("minSleepHours")
    min_sleep = float(min_sleep) if min_sleep is not None else 0.0

    # Anchor at the user's current habits so the plan is a delta from tonight.
    baseline_features = dict(features)
    baseline = _reliability(baseline_features)
    current_bedtime = float(
        baseline_features.get("bedtime_hour", FEATURE_DEFAULTS["bedtime_hour"])
    )

    bedtime, best_rel, curve = _latest_feasible_bedtime(baseline_features, target)

    # A bedtime is only useful if it also leaves room for enough sleep.
    sleep_at_plan = None
    if bedtime is not None:
        planned = _with(baseline_features, "bedtime_hour", bedtime)
        sleep_at_plan = float(predict_sleep(planned)["predictedSleepDuration"])
        if min_sleep and sleep_at_plan < min_sleep:
            bedtime = None  # clears reliability but not the sleep floor

    achieved = (
        _reliability(_with(baseline_features, "bedtime_hour", bedtime))
        if bedtime is not None
        else best_rel
    )

    levers = _rank_levers(baseline_features, target, baseline)
    habit_constraints = _habit_constraints(baseline_features, baseline)

    # When bedtime alone cannot get there, work out what the best combination of
    # changes achieves, and whether even that is enough.
    combined_steps: list[dict] = []
    combined_reliability = achieved
    if bedtime is None:
        _, combined_reliability, combined_steps = _optimize_plan(baseline_features, target)

    meets_target = (bedtime is not None) or combined_reliability >= target

    if bedtime is not None:
        shift_min = int(round((current_bedtime - bedtime) * 60))
        if shift_min > 5:
            summary = (
                f"Asleep by {_hhmm(bedtime)} - about {shift_min} min earlier than "
                f"your usual - reaches {achieved:.0%} wake reliability."
            )
        else:
            summary = (
                f"Your usual bedtime already reaches {achieved:.0%} wake reliability."
            )
    elif combined_reliability >= target:
        names = ", ".join(s["label"].lower() for s in combined_steps)
        summary = (
            f"Bedtime alone tops out at {best_rel:.0%}. Combining {len(combined_steps)} "
            f"changes ({names}) reaches {combined_reliability:.0%}."
        )
    else:
        gap = target - combined_reliability
        blockers = habit_constraints
        if blockers:
            summary = (
                f"{target:.0%} is not reachable tonight - the best combination of "
                f"changes reaches {combined_reliability:.0%}, short by {gap:.0%}. "
                f"What limits you is habit, not tonight: {blockers[0]['label'].lower()} "
                f"is worth {blockers[0]['reliabilityGain']:.0%} on its own. "
                "For tomorrow, set a backup alarm on a second device."
            )
        else:
            summary = (
                f"{target:.0%} is not reachable tonight - even the best combination of "
                f"changes reaches {combined_reliability:.0%}, short by {gap:.0%}. "
                "Set a backup alarm on a second device."
            )

    return {
        # Feasible by bedtime alone, versus feasible at all.
        "feasible": bedtime is not None,
        "reachesTarget": meets_target,
        "combinedPlan": combined_steps,
        "combinedReliability": round(combined_reliability, 4),
        # Separate track: what caps reliability over weeks, not tonight.
        "habitConstraints": habit_constraints,
        "targetReliability": round(target, 4),
        "baselineReliability": round(baseline, 4),
        "achievedReliability": round(achieved, 4),
        "recommendedBedtimeHour": round(bedtime, 2) if bedtime is not None else None,
        "recommendedBedtime": _hhmm(bedtime) if bedtime is not None else None,
        "currentBedtimeHour": round(current_bedtime, 2),
        "shiftMinutes": (
            int(round((current_bedtime - bedtime) * 60)) if bedtime is not None else None
        ),
        "predictedSleepHours": sleep_at_plan,
        "wakeTime": payload.get("wakeTime"),
        "levers": levers[:5],
        "reliabilityCurve": curve,
        "summary": summary,
    }


__all__ = ["plan_wake"]
