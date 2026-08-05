"""Sleep Score + personalized recommendation engine.

Implements the Sleep Score from the spec (Section 20.5):

    Score = 10 * (0.4 * duration + 0.3 * consistency + 0.3 * behavior)

with each sub-score in [0, 1]. Recommendations are rule-ranked from the user's
behavioral metrics so the engine degrades gracefully on sparse data and mirrors
the TypeScript fallback in lib/aiClient.ts.
"""

from __future__ import annotations

_PRIORITY_WEIGHT = {"high": 3, "medium": 2, "low": 1}

# Thresholds on model probabilities, set from the score distribution the trained
# model actually produces rather than from round numbers.
#
# The wake-success classifier is calibrated against a ~50% base rate, so
# oversleep probability has its median at 0.47: the old `> 0.5` test fired on
# 46.7% of nights and told half of all users their risk was "elevated". 0.70 is
# the 75th percentile, so the warning now means the top quartile of risk.
OVERSLEEP_ALERT = 0.70
# Mirror on the other side: 0.75 is roughly the top quartile of wake reliability.
# The previous 0.80 sat near the 12th percentile, so the encouraging message was
# effectively unreachable for ordinary users.
WAKE_RELIABLE = 0.75


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _num(value, default: float) -> float:
    try:
        if value is None:
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _duration_subscore(hours: float) -> float:
    """Plateau credit: full marks in the 7-9 h band, decaying outside it."""
    if hours <= 0:
        return 0.5
    if 7.0 <= hours <= 9.0:
        return 1.0
    edge = 7.0 if hours < 7.0 else 9.0
    return _clamp(1.0 - abs(hours - edge) / 3.0)


def compute_sleep_score(payload: dict | None) -> dict:
    payload = payload or {}
    metrics = payload.get("metrics") or {}
    goal = _num(payload.get("sleepGoalHours"), 8.0)

    # Duration: prefer a measured recent night, else the model prediction, else goal.
    duration_hours = payload.get("recentSleepHours")
    if duration_hours is None:
        duration_hours = payload.get("predictedSleepDuration")
    duration_hours = _num(duration_hours, goal)

    consistency = _clamp(_num(metrics.get("sleepConsistencyScore"), 50.0) / 100.0)
    wake_eff = _clamp(_num(metrics.get("wakeEfficiencyScore"), 60.0) / 100.0)
    fatigue = _clamp(_num(metrics.get("fatigueScore"), 40.0) / 100.0)
    resistance = _clamp(_num(metrics.get("wakeResistanceIndex"), 30.0) / 100.0)

    duration_sub = _duration_subscore(duration_hours)
    behavior_sub = _clamp(0.5 * wake_eff + 0.3 * (1.0 - fatigue) + 0.2 * (1.0 - resistance))

    score10 = 10.0 * (0.4 * duration_sub + 0.3 * consistency + 0.3 * behavior_sub)

    return {
        "sleepScore": round(score10, 1),
        "subScores": {
            "duration": round(duration_sub * 100),
            "consistency": round(consistency * 100),
            "behavior": round(behavior_sub * 100),
        },
        "basisDurationHours": round(duration_hours, 2),
    }


def recommend(payload: dict | None) -> list[dict]:
    payload = payload or {}
    metrics = payload.get("metrics") or {}

    duration = payload.get("recentSleepHours")
    if duration is None:
        duration = payload.get("predictedSleepDuration")
    duration = _num(duration, _num(payload.get("sleepGoalHours"), 8.0))

    consistency = _num(metrics.get("sleepConsistencyScore"), 50.0)
    fatigue = _num(metrics.get("fatigueScore"), 40.0)
    resistance = _num(metrics.get("wakeResistanceIndex"), 30.0)
    disruption = _num(metrics.get("sleepDisruptionScore"), 30.0)
    # Probabilities are 0..1 from both the model output and the metrics layer.
    oversleep = _num(
        payload.get("oversleepProbability"),
        _num(metrics.get("oversleepProbability"), 0.3),
    )
    wake_success = _num(
        payload.get("wakeSuccessProbability"),
        _num(metrics.get("wakeSuccessProbability"), 0.7),
    )

    tips: list[dict] = []

    if duration < 6.5:
        tips.append({
            "text": f"You're averaging about {duration:.1f} h of sleep. Aim for 7-9 h with an earlier wind-down.",
            "priority": "high",
            "icon": "moon",
            "basis": "short sleep duration",
        })
    elif duration > 9.5:
        tips.append({
            "text": f"You're sleeping about {duration:.1f} h. Consistently long sleep can signal sleep debt or low quality.",
            "priority": "low",
            "icon": "moon",
            "basis": "long sleep duration",
        })

    if consistency < 50:
        tips.append({
            "text": "Your sleep timing varies a lot. Keep bedtime and wake time within +/-30 min, even on weekends.",
            "priority": "high",
            "icon": "repeat",
            "basis": "low sleep consistency",
        })

    if oversleep > OVERSLEEP_ALERT:
        tips.append({
            "text": "Elevated oversleep risk for your next wake. Enable verification and a backup escalation level.",
            "priority": "high",
            "icon": "alert-triangle",
            "basis": "high oversleep probability",
        })

    if fatigue > 60:
        tips.append({
            "text": "High fatigue detected. Cut caffeine after midday and reduce evening screen time.",
            "priority": "medium",
            "icon": "battery-low",
            "basis": "high fatigue score",
        })

    if resistance > 50:
        tips.append({
            "text": "You snooze often. Place the alarm across the room or require a wake challenge to dismiss it.",
            "priority": "medium",
            "icon": "alarm-clock",
            "basis": "high wake resistance",
        })

    if disruption > 55:
        tips.append({
            "text": "Nighttime noise or movement is disrupting your sleep. Aim for a quieter, cooler, darker room.",
            "priority": "medium",
            "icon": "volume-x",
            "basis": "high sleep disruption",
        })

    if wake_success >= WAKE_RELIABLE and consistency >= 60:
        tips.append({
            "text": "Great wake reliability and steady timing - keep your current routine going.",
            "priority": "low",
            "icon": "check",
            "basis": "strong wake success",
        })

    if not tips:
        # No rule fired. That means either there's nothing to go on yet, or the
        # user is simply doing fine -- reporting "insufficient data" to someone
        # with a fortnight of logs is just wrong. computeMetrics needs two
        # nights before its consistency score is meaningful.
        if _num(metrics.get("nights"), 0.0) < 3:
            tips.append({
                "text": "Log a few nights of sleep to unlock personalized coaching.",
                "priority": "low",
                "icon": "info",
                "basis": "insufficient data",
            })
        else:
            tips.append({
                "text": "Nothing needs attention - your sleep and wake routine are on track.",
                "priority": "low",
                "icon": "check",
                "basis": "all metrics within target",
            })

    tips.sort(key=lambda t: _PRIORITY_WEIGHT.get(t["priority"], 0), reverse=True)
    return tips[:5]


def build_report(payload: dict | None) -> dict:
    score = compute_sleep_score(payload)
    return {
        **score,
        "recommendations": recommend(payload),
    }


__all__ = ["build_report", "compute_sleep_score", "recommend"]