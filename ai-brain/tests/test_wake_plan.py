"""Tests for reliability-targeted inverse wake planning.

The model itself is stubbed out throughout. That is deliberate: what is under
test is the *search* - does the inversion find the latest admissible bedtime,
does coordinate ascent combine levers without double-counting, does an
infeasible request produce an honest verdict with the right attribution. A
RandomForest in the loop would make those assertions probabilistic and slow, and
would be testing scikit-learn rather than this module.

Each test installs a small analytic reliability function whose correct answer is
known by construction, so a failure points at the search, not the data.
"""

from __future__ import annotations

import pytest

import wake_plan
from feature_spec import FEATURE_DEFAULTS


def feat(features: dict, name: str) -> float:
    """Read a feature the way the module does, falling back to the schema."""
    return float(features.get(name, FEATURE_DEFAULTS[name]))


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


@pytest.fixture
def model(monkeypatch):
    """Install a stub reliability model in place of the trained forest."""

    def install(fn, sleep_hours: float = 7.5):
        monkeypatch.setattr(
            wake_plan, "predict_wake_success",
            lambda f: {"wakeSuccessProbability": fn(f or {})},
        )
        monkeypatch.setattr(
            wake_plan, "predict_wake_success_batch",
            lambda rows: [fn(r or {}) for r in rows],
        )
        monkeypatch.setattr(
            wake_plan, "predict_sleep",
            lambda f: {"predictedSleepDuration": sleep_hours},
        )

    return install


# ---------------------------------------------------------------------------
# Feasible plans
# ---------------------------------------------------------------------------


def bedtime_only(features: dict) -> float:
    """Reliability rises 0.1 per hour earlier than 26:00. 22:00 -> exactly 0.8."""
    return clamp01(1.0 - (feat(features, "bedtime_hour") - 20.0) * 0.1)


def test_finds_the_latest_bedtime_that_clears_the_target(model):
    model(bedtime_only)
    result = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.5}, "requiredReliability": 0.8}
    )

    assert result["feasible"] is True
    assert result["reachesTarget"] is True
    # 22:00 scores exactly 0.80; 22:15 scores 0.775 and would miss.
    assert result["recommendedBedtimeHour"] == 22.0
    assert result["recommendedBedtime"] == "22:00"
    assert result["achievedReliability"] >= 0.8


def test_prefers_the_latest_qualifying_bedtime_not_the_safest(model):
    """The objective is least behavioural cost, so it must not over-shoot."""
    model(bedtime_only)
    result = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.5}, "requiredReliability": 0.5}
    )
    # 25:00 already clears 0.5; recommending 21:00 would be needlessly punitive.
    assert result["recommendedBedtimeHour"] == 25.0
    assert result["shiftMinutes"] == -90  # actually a later bedtime than usual


def test_reports_the_shift_from_the_users_current_bedtime(model):
    model(bedtime_only)
    result = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.5}, "requiredReliability": 0.8}
    )
    assert result["currentBedtimeHour"] == 23.5
    assert result["shiftMinutes"] == 90
    assert "90 min earlier" in result["summary"]


def test_says_so_when_the_usual_bedtime_already_suffices(model):
    model(bedtime_only)
    result = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 22.0}, "requiredReliability": 0.8}
    )
    assert result["feasible"] is True
    assert "already reaches" in result["summary"]


def test_rejects_a_bedtime_that_clears_reliability_but_not_the_sleep_floor(model):
    """A bedtime that wakes you reliably on four hours' sleep is not a plan."""
    model(bedtime_only, sleep_hours=4.0)
    result = wake_plan.plan_wake(
        {
            "features": {"bedtime_hour": 23.5},
            "requiredReliability": 0.8,
            "minSleepHours": 7.0,
        }
    )
    assert result["feasible"] is False
    assert result["recommendedBedtimeHour"] is None


def test_returns_the_whole_curve_in_chronological_order(model):
    model(bedtime_only)
    curve = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.0}, "requiredReliability": 0.8}
    )["reliabilityCurve"]

    assert len(curve) == 25  # 20:00..26:00 at 15-minute resolution
    hours = [p["bedtimeHour"] for p in curve]
    assert hours == sorted(hours)
    assert hours[0] == 20.0 and hours[-1] == 26.0


# ---------------------------------------------------------------------------
# Lever ranking
# ---------------------------------------------------------------------------


def lever_model(features: dict) -> float:
    """Caffeine is worth 0.15, screen time 0.05; nothing else moves."""
    rel = 0.40
    rel += (80.0 - feat(features, "caffeine_mg")) / 80.0 * 0.15
    rel += (45.0 - feat(features, "screen_minutes_before_bed")) / 45.0 * 0.05
    return clamp01(rel)


def test_ranks_levers_by_what_each_buys_on_its_own(model):
    model(lever_model)
    levers = wake_plan.plan_wake(
        {"features": {"caffeine_mg": 80, "screen_minutes_before_bed": 45},
         "requiredReliability": 0.9}
    )["levers"]

    assert [l["feature"] for l in levers] == ["caffeine_mg", "screen_minutes_before_bed"]
    assert levers[0]["reliabilityGain"] == pytest.approx(0.15, abs=1e-3)
    assert levers[1]["reliabilityGain"] == pytest.approx(0.05, abs=1e-3)
    # Reported as an instruction, not just a number.
    assert levers[0]["label"] == "Cut afternoon caffeine"
    assert levers[0]["from"] == 80.0 and levers[0]["to"] == 0.0


def test_omits_levers_that_buy_nothing(model):
    model(lever_model)
    levers = wake_plan.plan_wake(
        {"features": {"caffeine_mg": 80}, "requiredReliability": 0.9}
    )["levers"]
    moved = {l["feature"] for l in levers}
    assert "exercise_minutes" not in moved
    assert "ambient_noise_db" not in moved


def test_marks_a_lever_that_closes_the_gap_by_itself(model):
    model(lever_model)
    # Baseline 0.40, target 0.55: cutting caffeine alone (+0.15) is sufficient.
    levers = wake_plan.plan_wake(
        {"features": {"caffeine_mg": 80}, "requiredReliability": 0.55}
    )["levers"]
    caffeine = next(l for l in levers if l["feature"] == "caffeine_mg")
    assert caffeine["closesGap"] is True


def test_caps_the_lever_list(model):
    model(lambda f: clamp01(0.3 + (80.0 - feat(f, "caffeine_mg")) / 800.0
                            + (45.0 - feat(f, "screen_minutes_before_bed")) / 450.0
                            + (40.0 - feat(f, "stress_level")) / 400.0
                            + (35.0 - feat(f, "ambient_noise_db")) / 350.0
                            + (feat(f, "exercise_minutes") - 30.0) / 1200.0
                            + (26.0 - feat(f, "bedtime_hour")) / 60.0))
    levers = wake_plan.plan_wake({"features": {}, "requiredReliability": 0.99})["levers"]
    assert len(levers) <= 5


# ---------------------------------------------------------------------------
# Combined plans (greedy coordinate ascent)
# ---------------------------------------------------------------------------


def capped_bedtime_model(features: dict) -> float:
    """Bedtime alone tops out at +0.20; caffeine adds another 0.25."""
    bedtime_gain = min(0.20, max(0.0, (23.0 - feat(features, "bedtime_hour")) * 0.1))
    caffeine_gain = (80.0 - feat(features, "caffeine_mg")) / 80.0 * 0.25
    return clamp01(0.30 + bedtime_gain + caffeine_gain)


def test_combines_levers_when_bedtime_alone_cannot_reach_the_target(model):
    model(capped_bedtime_model)
    result = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.0, "caffeine_mg": 80},
         "requiredReliability": 0.65}
    )

    # Bedtime alone maxes at 0.50, so the single-lever answer is unavailable...
    assert result["feasible"] is False
    # ...but the combination gets there, and that is reported as success.
    assert result["reachesTarget"] is True
    assert result["combinedReliability"] >= 0.65
    assert "Combining" in result["summary"]


def test_folds_repeated_moves_on_one_lever_into_a_single_instruction(model):
    """The plan should read 'go to bed earlier', not say it three times."""
    model(capped_bedtime_model)
    steps = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.0, "caffeine_mg": 80},
         "requiredReliability": 0.65}
    )["combinedPlan"]

    features_moved = [s["feature"] for s in steps]
    assert len(features_moved) == len(set(features_moved))
    bedtime_step = next(s for s in steps if s["feature"] == "bedtime_hour")
    # Two 45-minute moves folded into one instruction spanning both.
    assert bedtime_step["from"] == 23.0
    assert bedtime_step["to"] < 22.0


def test_stops_as_soon_as_the_target_is_met(model):
    """Fewest changes that suffice, not every change available."""
    model(capped_bedtime_model)
    # 0.52 sits just above bedtime's 0.50 ceiling, so a combination is needed -
    # but cutting caffeine alone (+0.25 on a 0.30 baseline) already clears it,
    # and the search must stop there rather than piling on bedtime as well.
    steps = wake_plan.plan_wake(
        {"features": {"bedtime_hour": 23.0, "caffeine_mg": 80},
         "requiredReliability": 0.52}
    )["combinedPlan"]
    assert len(steps) == 1
    assert steps[0]["feature"] == "caffeine_mg"


# ---------------------------------------------------------------------------
# Infeasibility and habit attribution
# ---------------------------------------------------------------------------


def habit_bound_model(features: dict) -> float:
    """Nothing tonight helps. Only long-run habit changes move the number."""
    rel = 0.30
    if feat(features, "alarm_response_ms") <= 5000.0:
        rel += 0.28
    if feat(features, "sleep_consistency") >= 85.0:
        rel += 0.10
    return clamp01(rel)


HABIT_BOUND_FEATURES = {
    "bedtime_hour": 23.0,
    "alarm_response_ms": 19000.0,
    "sleep_consistency": 60.0,
}


def test_declares_infeasibility_instead_of_reporting_a_bare_number(model):
    model(habit_bound_model)
    result = wake_plan.plan_wake(
        {"features": HABIT_BOUND_FEATURES, "requiredReliability": 0.95}
    )

    assert result["feasible"] is False
    assert result["reachesTarget"] is False
    assert result["recommendedBedtime"] is None
    # The achievable ceiling is stated rather than left for the user to infer.
    assert result["achievedReliability"] == pytest.approx(0.30, abs=1e-3)
    assert "not reachable tonight" in result["summary"]


def test_attributes_the_shortfall_to_the_binding_habit(model):
    model(habit_bound_model)
    result = wake_plan.plan_wake(
        {"features": HABIT_BOUND_FEATURES, "requiredReliability": 0.95}
    )
    habits = result["habitConstraints"]

    # Strongest constraint first: 19s alarm response is worth 28 points alone.
    assert habits[0]["feature"] == "alarm_response_ms"
    assert habits[0]["reliabilityGain"] == pytest.approx(0.28, abs=1e-3)
    assert habits[0]["horizon"] == "weeks"
    assert habits[1]["feature"] == "sleep_consistency"

    # And the summary says which, in words, rather than only in the payload.
    assert "habit, not tonight" in result["summary"]
    assert "first alarm" in result["summary"]
    assert "28%" in result["summary"]


def test_recommends_a_backup_device_when_the_target_is_unreachable(model):
    model(habit_bound_model)
    summary = wake_plan.plan_wake(
        {"features": HABIT_BOUND_FEATURES, "requiredReliability": 0.95}
    )["summary"]
    assert "backup alarm" in summary


def test_keeps_habit_constraints_out_of_the_tonight_plan(model):
    """Habit fixes take weeks; mixing them into tonight's steps would mislead."""
    model(habit_bound_model)
    result = wake_plan.plan_wake(
        {"features": HABIT_BOUND_FEATURES, "requiredReliability": 0.95}
    )
    tonight = {s["feature"] for s in result["combinedPlan"]}
    habit = {h["feature"] for h in result["habitConstraints"]}
    assert tonight.isdisjoint(habit)
    assert habit  # the attribution is non-empty, so this is a real check


def test_falls_back_gracefully_when_nothing_at_all_explains_the_shortfall(model):
    """A flat model has no levers and no habits - it must still be honest."""
    model(lambda f: 0.30)
    result = wake_plan.plan_wake({"features": {}, "requiredReliability": 0.95})

    assert result["reachesTarget"] is False
    assert result["habitConstraints"] == []
    assert result["levers"] == []
    assert "not reachable tonight" in result["summary"]
    assert "backup alarm" in result["summary"]


# ---------------------------------------------------------------------------
# Payload handling
# ---------------------------------------------------------------------------


def test_defaults_the_target_when_the_caller_omits_it(model):
    model(bedtime_only)
    assert wake_plan.plan_wake({"features": {}})["targetReliability"] == 0.9


def test_treats_an_explicit_null_target_as_absent(model):
    """Pydantic emits unset optionals as None, which dict.get would pass through."""
    model(bedtime_only)
    result = wake_plan.plan_wake({"features": {}, "requiredReliability": None})
    assert result["targetReliability"] == 0.9


def test_clamps_an_impossible_target(model):
    model(bedtime_only)
    assert wake_plan.plan_wake({"features": {}, "requiredReliability": 1.5})[
        "targetReliability"
    ] == 0.99
    assert wake_plan.plan_wake({"features": {}, "requiredReliability": 0.0})[
        "targetReliability"
    ] == 0.05


def test_survives_an_empty_payload(model):
    model(bedtime_only)
    result = wake_plan.plan_wake(None)
    assert "summary" in result
    assert result["targetReliability"] == 0.9


@pytest.mark.parametrize(
    "hour,expected",
    [(23.75, "23:45"), (25.5, "01:30"), (24.0, "00:00"), (20.0, "20:00"),
     (22.999, "23:00")],
)
def test_formats_bedtimes_across_midnight(hour, expected):
    assert wake_plan._hhmm(hour) == expected
