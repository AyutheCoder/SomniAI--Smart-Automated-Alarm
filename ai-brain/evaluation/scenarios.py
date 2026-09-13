"""Ground-truth reliability functions for the simulation study.

A planner only tested on smooth, monotone, independent responses has not really
been tested — that is the case every reasonable algorithm handles. These
deliberately include the shapes that break greedy search:

*Non-monotone.* Reliability that dips before rising means "earlier is better" is
false locally, so a search relying on monotonicity finds a local optimum.

*Redundant levers.* Two levers addressing the same underlying cause. Greedy
ascent that adds their gains independently over-counts and stops too early;
`_optimize_plan` re-scores after each committed move specifically to avoid this,
so this is the case that tests whether the re-scoring works.

*Interacting levers.* One lever only helps once another has moved. Greedy sees
no first-step gain from either and can stall.

*Ceilinged.* Nothing reaches beyond a hard maximum, so targets above it must be
refused and targets just below must be met.
"""

from __future__ import annotations

import math

from feature_spec import FEATURE_DEFAULTS


def _f(features: dict, name: str) -> float:
    return float(features.get(name, FEATURE_DEFAULTS[name]))


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


BASELINE = {
    "bedtime_hour": 24.0,
    "screen_minutes_before_bed": 90.0,
    "caffeine_mg": 200.0,
    "ambient_noise_db": 50.0,
    "room_temp_c": 25.0,
    "stress_level": 70.0,
    "exercise_minutes": 10.0,
}


def monotone(features: dict) -> float:
    """Smooth and well behaved: the easy case, included as a control."""
    r = 0.30
    r += (24.0 - _f(features, "bedtime_hour")) * 0.10
    r += (200.0 - _f(features, "caffeine_mg")) / 200.0 * 0.15
    r += (90.0 - _f(features, "screen_minutes_before_bed")) / 90.0 * 0.10
    return _clamp01(r)


def non_monotone(features: dict) -> float:
    """Reliability dips before rising as bedtime moves earlier.

    Physiologically this is the forbidden zone of wakefulness before the
    circadian gate opens. Algorithmically it means a sweep that stops at the
    first improvement lands in the wrong place.
    """
    bedtime = _f(features, "bedtime_hour")
    r = 0.35 + (24.0 - bedtime) * 0.09
    r -= 0.18 * math.exp(-((bedtime - 22.5) ** 2) / 0.35)   # a dip around 22:30
    r += (200.0 - _f(features, "caffeine_mg")) / 200.0 * 0.12
    return _clamp01(r)


def redundant_levers(features: dict) -> float:
    """Screen time and caffeine act through one shared channel.

    Their individual gains do not add. A planner counting both separately
    believes it has bought more than it has.
    """
    screen = (90.0 - _f(features, "screen_minutes_before_bed")) / 90.0
    caffeine = (200.0 - _f(features, "caffeine_mg")) / 200.0
    shared = max(screen, caffeine)          # not screen + caffeine
    return _clamp01(0.35 + (24.0 - _f(features, "bedtime_hour")) * 0.08 + shared * 0.25)


def interacting_levers(features: dict) -> float:
    """A quiet room only helps once the temperature is comfortable.

    Neither lever shows a first-step gain alone, which is where a purely greedy
    search can stall short of a reachable target.
    """
    quiet = (50.0 - _f(features, "ambient_noise_db")) / 30.0
    comfortable = 1.0 - abs(_f(features, "room_temp_c") - 20.5) / 6.0
    interaction = max(0.0, quiet) * max(0.0, comfortable) * 0.30
    return _clamp01(0.35 + (24.0 - _f(features, "bedtime_hour")) * 0.07 + interaction)


def ceilinged(features: dict) -> float:
    """Hard ceiling at 0.72 whatever anyone does.

    Tests the boundary directly: targets above must be refused, targets just
    below must be met.
    """
    return min(0.72, monotone(features))


def habit_bound(features: dict) -> float:
    """Nothing controllable helps; only long-run habit does.

    The case the attribution machinery exists for - "the limit is not tonight".
    """
    r = 0.30
    if _f(features, "alarm_response_ms") <= 5000.0:
        r += 0.30
    if _f(features, "sleep_consistency") >= 85.0:
        r += 0.15
    return _clamp01(r)


def flat(features: dict) -> float:
    """Constant. Every target above it is unreachable and must be refused."""
    return 0.40


SCENARIOS = {
    "monotone": (monotone, dict(BASELINE)),
    "non_monotone": (non_monotone, dict(BASELINE)),
    "redundant_levers": (redundant_levers, dict(BASELINE)),
    "interacting_levers": (interacting_levers, dict(BASELINE)),
    "ceilinged": (ceilinged, dict(BASELINE)),
    "habit_bound": (habit_bound, dict(BASELINE, alarm_response_ms=19000.0,
                                      sleep_consistency=55.0)),
    "flat": (flat, dict(BASELINE)),
}
