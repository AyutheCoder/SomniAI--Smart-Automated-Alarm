"""The exact-ceiling boundary of reliability-targeted wake planning.

Asking for exactly the best reliability the planner can reach must be granted;
asking for a hair more must be refused, honestly, with the ceiling reported.
Both edges matter: the one where bedtime alone stops sufficing and a combination
of changes takes over, and the one where nothing suffices at all.

The last test pins the contract the app relies on. Reported reliabilities are
rounded to four places, so a ceiling of 0.84996 is reported as 0.85, equal to an
0.85 target that was refused. Only `reachesTarget`, decided on unrounded values,
says whether the target is met; the UI must never recompute it.

Uses the stub models from test_wake_plan.py, for the same reason given there:
the search is under test, not the forest.
"""

from __future__ import annotations

import pytest

import wake_plan
from tests.test_wake_plan import capped_bedtime_model, model  # noqa: F401  (fixture)

FEATURES = {"bedtime_hour": 23.0, "caffeine_mg": 80}
HAIR = 1e-6


def plan(target: float) -> dict:
    return wake_plan.plan_wake({"features": dict(FEATURES), "requiredReliability": target})


def test_bedtime_alone_reaches_exactly_its_ceiling_and_no_further(model):
    model(capped_bedtime_model)
    _, bedtime_ceiling, _ = wake_plan._latest_feasible_bedtime(dict(FEATURES), 0.99)
    assert bedtime_ceiling == pytest.approx(0.50)

    at = plan(bedtime_ceiling)
    assert at["feasible"] is True
    assert at["reachesTarget"] is True
    assert at["recommendedBedtime"] is not None
    assert at["combinedPlan"] == []

    above = plan(bedtime_ceiling + HAIR)
    # Bedtime alone no longer suffices, so it gives no bedtime...
    assert above["feasible"] is False
    assert above["recommendedBedtime"] is None
    # ...and the smallest combination of changes takes over.
    assert above["reachesTarget"] is True
    assert above["combinedPlan"]


def test_the_overall_ceiling_is_granted_exactly_and_refused_just_above(model):
    model(capped_bedtime_model)
    _, ceiling, _ = wake_plan._optimize_plan(dict(FEATURES), 0.99)
    assert 0.50 < ceiling < 0.99

    at = plan(ceiling)
    assert at["reachesTarget"] is True
    assert "not reachable" not in at["summary"]

    above = plan(ceiling + HAIR)
    assert above["reachesTarget"] is False
    assert above["feasible"] is False
    # The refusal reports the ceiling it could reach, and how far short that is.
    assert above["combinedReliability"] == round(ceiling, 4)
    assert "is not reachable tonight" in above["summary"]
    assert "backup alarm on a second device" in above["summary"]


def test_rounded_numbers_cannot_decide_feasibility(model):
    """A refused target can be reported equal to the ceiling after rounding."""
    model(lambda features: 0.84996)
    result = wake_plan.plan_wake({"features": {}, "requiredReliability": 0.85})
    assert result["reachesTarget"] is False
    assert result["combinedReliability"] == result["targetReliability"] == 0.85
