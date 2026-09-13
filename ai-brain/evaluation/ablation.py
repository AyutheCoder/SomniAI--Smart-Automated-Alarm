"""Ablating the refusal machinery.

Which parts of the planner actually earn their place? Each component is disabled
in turn and the result graded against the same exhaustive ground truth used in
`simulation.py`, so "this piece matters" is measured rather than assumed.

Run in simulation deliberately. Refusal quality is a statement about whether a
verdict was *correct*, and correctness needs a known answer — which only exists
where the reliability function is something we wrote down. On real data all four
components still run, but there is nothing to grade them against.

**One limitation to carry into the paper.** The simulation exercises all seven
controllable levers. Real cohorts supply three — bedtime, stress and exercise —
because no wearable dataset records screen time, caffeine, ambient noise or room
temperature. So the coordinate-ascent ablation below measures what that component
contributes *when its full lever set exists*, which is an upper bound on what it
contributes in deployment today. Reported as such rather than by quietly
redefining `CONTROLLABLE` to whatever happens to be available.
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wake_plan  # noqa: E402
from evaluation import scenarios, simulation  # noqa: E402

# Habit features as if they were tonight's levers, for the partition ablation.
# Direction, floor, ceiling and step follow the same shape as CONTROLLABLE.
_HABIT_AS_LEVERS = [
    ("sleep_consistency", +1, 0.0, 100.0, 10.0, "Be more consistent"),
    ("snooze_count", -1, 0.0, 6.0, 1.0, "Snooze less"),
    ("alarm_response_ms", -1, 500.0, 30000.0, 5000.0, "Respond faster"),
    ("sleep_debt_hours", -1, -2.0, 4.0, 1.0, "Clear sleep debt"),
]

ABLATIONS = ("none", "sweep", "ascent", "partition", "attribution")


@contextmanager
def ablate(component: str):
    """Disable one component of the planner for the duration of the block."""
    original_sweep = wake_plan._latest_feasible_bedtime
    original_optimize = wake_plan._optimize_plan
    original_habits = wake_plan._habit_constraints
    original_controllable = list(wake_plan.CONTROLLABLE)

    if component == "sweep":
        # Keep scoring the curve - the planner still needs `best_rel` - but never
        # return a feasible bedtime, so only coordinate ascent can succeed.
        def no_sweep(features, target, _f=original_sweep):
            _, best_rel, curve = _f(features, target)
            return None, best_rel, curve
        wake_plan._latest_feasible_bedtime = no_sweep

    elif component == "ascent":
        # Bedtime sweep only: no combination of levers is ever searched.
        def no_ascent(features, target, max_rounds=0, _f=original_optimize):
            return dict(features), wake_plan._reliability(features), []
        wake_plan._optimize_plan = no_ascent

    elif component == "partition":
        # Treat habit-level inputs as if they were changeable tonight - the
        # error the controllable/habit split exists to prevent.
        wake_plan.CONTROLLABLE = original_controllable + _HABIT_AS_LEVERS

    elif component == "attribution":
        wake_plan._habit_constraints = lambda features, baseline: []

    elif component != "none":
        raise ValueError(f"unknown ablation {component!r}")

    try:
        yield
    finally:
        wake_plan._latest_feasible_bedtime = original_sweep
        wake_plan._optimize_plan = original_optimize
        wake_plan._habit_constraints = original_habits
        wake_plan.CONTROLLABLE = original_controllable


def study(
    components: tuple[str, ...] = ABLATIONS,
    scenario_set: dict | None = None,
    targets: tuple[float, ...] = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95),
    max_steps: int = 24,
) -> pd.DataFrame:
    """Grade each ablation against exhaustive ground truth.

    `max_steps` covers what the planner can reach at the production budget of 8
    rounds (3 steps per round). A narrower ground truth would be smaller than the
    planner's own reach and would manufacture phantom broken promises.
    """
    scenario_set = scenario_set or scenarios.SCENARIOS
    # The honest lever set, captured before any ablation widens it. Ground truth
    # is always the world as it really is: habit-level inputs cannot be changed
    # tonight, whatever an ablated planner believes. Grading the `partition`
    # ablation against its own inflated set would hide exactly the failure it is
    # meant to expose - and would make the exhaustive search intractable.
    honest_levers = list(wake_plan.CONTROLLABLE)
    rows = []
    for component in components:
        with ablate(component):
            df = simulation.study(scenario_set, targets=targets, max_steps=max_steps,
                                  levers=honest_levers)
        solved = df[df.truth_minimal_levers.notna() & df.planner_promises]
        rows.append({
            "ablation": component,
            "verdict_correct": round(float(df.verdict_correct.mean()), 3),
            "false_refusals": int(df.false_refusal.sum()),
            "broken_promises": int(df.broken_promise.sum()),
            "bedtime_optimal": round(float(df.bedtime_optimal.mean()), 3),
            "promised": int(df.planner_promises.sum()),
            "exactly_minimal": (
                round(float((solved.planner_levers == solved.truth_minimal_levers).mean()), 3)
                if len(solved) else float("nan")
            ),
            "n": len(df),
        })
    return pd.DataFrame(rows)


def attribution_quality(scenario_set: dict | None = None) -> pd.DataFrame:
    """What the counterfactual attribution adds, which soundness cannot show.

    Removing it changes no verdict — the planner refuses exactly as before. What
    disappears is the explanation, so it is measured by whether an infeasible
    plan still names the habit that caused the shortfall.
    """
    scenario_set = scenario_set or {"habit_bound": scenarios.SCENARIOS["habit_bound"]}
    rows = []
    for component in ("none", "attribution"):
        with ablate(component):
            for name, (model, feats) in scenario_set.items():
                with simulation.planner_using_fn(model):
                    plan = wake_plan.plan_wake({"features": dict(feats),
                                                "requiredReliability": 0.95})
                rows.append({
                    "ablation": component,
                    "scenario": name,
                    "refused": not plan["reachesTarget"],
                    "habit_causes_named": len(plan["habitConstraints"]),
                    "summary_explains_why": "habit, not tonight" in plan["summary"],
                })
    return pd.DataFrame(rows)
