"""Builds `data/enhanced_sleep_dataset.csv`.

Rather than sampling the 15 model features independently, this simulates a panel
of sleepers night by night and lets the features fall out of that simulation, so
the correlations a real user exhibits (an owl goes to bed late; a fit user walks
more and has a lower resting HR; a short night is followed by extra snoozes) are
present in the training data.

Two properties are deliberate, because they decide whether the served model sees
anything like what it was trained on:

*   The aggregate features (`sleep_consistency`, `sleep_debt_hours`,
    `snooze_count`, `alarm_response_ms`) are computed here with the same trailing
    -window formulas `lib/features.ts` and `lib/aiFeatures.ts` use, not drawn as
    single-night values.
*   Each feature's population median is held close to its `FEATURE_SPEC`
    default, because `buildUserSignals` supplies only ~9 of the 15 features and
    the rest arrive at inference as defaults.

One row is one prediction the app actually makes: the user's profile plus
tonight's context, labelled with how the *next* night goes.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

# Allow running as `python training/dataset_builder.py` from the ai-brain root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from feature_spec import FEATURE_NAMES, FEATURE_SPEC  # noqa: E402

SEED = 42

N_PERSONS = 340
NIGHTS_PER_PERSON = 46      # simulated nights per person
WARMUP_NIGHTS = 14          # nights consumed by the trailing windows
WINDOW_NIGHTS = 14          # trailing window for the aggregate features
WAKE_HORIZON = 7            # forward window for the wake-consistency target

RANGES: dict[str, tuple[float, float]] = {
    name: (lo, hi) for name, _default, (lo, hi) in FEATURE_SPEC
}

TARGET_COLUMNS = ["sleep_duration", "wakeup_consistency", "wake_success"]
META_COLUMNS = ["person_id", "night_index"]

# Rounding applied per column on write: the raw simulation emits 15 significant
# digits, which triples the file size and implies precision that isn't there.
DECIMALS: dict[str, int] = {
    "age": 0,
    "chronotype_code": 0,
    "bedtime_hour": 2,
    "screen_minutes_before_bed": 0,
    "caffeine_mg": 0,
    "exercise_minutes": 0,
    "stress_level": 1,
    "ambient_noise_db": 1,
    "room_temp_c": 1,
    "resting_hr": 0,
    "steps": 0,
    "snooze_count": 0,
    "alarm_response_ms": 0,
    "sleep_consistency": 1,
    "sleep_debt_hours": 2,
    "sleep_duration": 2,
    "wakeup_consistency": 1,
    "wake_success": 0,
}


def _clip(name: str, values):
    lo, hi = RANGES[name]
    return np.clip(values, lo, hi)


def _consistency_score(minutes: list[float]) -> float:
    """Regularity of a set of clock times, as `lib/features.ts` scores it.

    `pct(1 - stdev / 120)` over the timestamps in minutes, with the same 50.0
    fallback the app uses when there aren't yet two observations.
    """
    if len(minutes) < 2:
        return 50.0
    spread = float(np.std(minutes))
    return float(np.clip(1.0 - spread / 120.0, 0.0, 1.0) * 100.0)


def _sample_people(rng: np.random.Generator) -> pd.DataFrame:
    """Draw the per-person traits that stay fixed across their nights."""
    n = N_PERSONS

    # Right-skewed toward the twenties/thirties this app is used by; median ~30.
    # A student cohort is mixed in, or the lognormal tail never reaches the teens.
    age = np.where(
        rng.random(n) < 0.12,
        rng.uniform(16.0, 24.0, n),
        16.0 + rng.lognormal(np.log(14.5), 0.55, n),
    )
    age = _clip("age", age)

    # Chronotype tracks age: eveningness peaks in the late teens/twenties and
    # drifts earlier from there. Thresholds give roughly 27/35/38 lark/int/owl.
    owl_score = (32.0 - age) / 14.0 + rng.normal(0.0, 1.0, n)
    chronotype = np.digitize(owl_score, [-0.45, 0.55]).astype(float)

    fitness = rng.beta(2.6, 2.6, n)                     # 0 sedentary .. 1 athletic
    stress_trait = rng.beta(2.8, 3.4, n)                # baseline stressfulness
    regularity = rng.beta(2.6, 2.0, n)                  # keeps a fixed schedule?
    resilience = rng.beta(3.0, 2.4, n)                  # gets up despite grogginess

    return pd.DataFrame({
        "age": age,
        "chronotype_code": chronotype,
        "fitness": fitness,
        "stress_trait": stress_trait,
        "regularity": regularity,
        "resilience": resilience,
        # Habits, centered so the population median lands on the spec default.
        "screen_habit": _clip("screen_minutes_before_bed", rng.gamma(3.8, 10.6, n)),
        "caffeine_habit": _clip("caffeine_mg", rng.gamma(2.0, 27.0, n)),
        # Bedroom properties: a person's room is much the same every night.
        "noise_base": _clip("ambient_noise_db", 28.0 + rng.gamma(2.0, 4.2, n)),
        "temp_base": _clip("room_temp_c", rng.normal(21.8, 2.1, n)),
        "hr_base": rng.normal(0.0, 3.0, n),             # idiosyncratic HR offset
        "sleep_need": np.clip(rng.normal(8.0, 0.45, n), 6.5, 9.5),
        # Alarm target, in hours after midnight; larks aim earlier.
        "alarm_hour": np.clip(
            rng.normal(6.9, 0.75, n) - (1.0 - chronotype) * 0.35, 4.5, 10.0
        ),
        "goal_hours": np.clip(rng.normal(8.0, 0.3, n), 6.0, 9.0),
    })


def _simulate_person(person: pd.Series, rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Run one sleeper through `NIGHTS_PER_PERSON` consecutive nights."""
    n = NIGHTS_PER_PERSON
    age = float(person.age)
    chrono = float(person.chronotype_code)
    fitness = float(person.fitness)
    regularity = float(person.regularity)

    weekday = np.arange(n) % 7
    is_weekend = np.isin(weekday, [4, 5])       # Fri/Sat night: alarm often off
    free_morning = is_weekend & (rng.random(n) < 0.8)

    # --- Nightly context -----------------------------------------------------
    stress = _clip("stress_level", (
        float(person.stress_trait) * 100.0
        - is_weekend * 9.0
        + rng.normal(0.0, 9.0, n)
    ))

    screen = _clip("screen_minutes_before_bed", (
        float(person.screen_habit)
        + 0.30 * (stress - 40.0)
        + 11.0 * (chrono - 1.0)
        + is_weekend * 14.0
        + rng.normal(0.0, 14.0, n)
    ))

    # Zero-inflated: most people don't train every day, so the column's mean
    # rather than its median is what sits near the spec default.
    exercised = rng.random(n) < (0.34 + 0.44 * fitness)
    exercise = _clip("exercise_minutes", np.where(
        exercised, rng.gamma(2.4, (16.0 + 15.0 * fitness), n), 0.0
    ))

    steps = _clip("steps", (
        (2600.0 + 7200.0 * fitness) * rng.lognormal(0.0, 0.26, n)
        + 21.0 * exercise
    ))

    noise = _clip("ambient_noise_db", float(person.noise_base) + rng.normal(0.0, 3.6, n))
    # A slow seasonal drift, so room temperature is autocorrelated across nights.
    season = np.sin(np.arange(n) / 30.0 + rng.uniform(0, 6.28))
    temp = _clip("room_temp_c", float(person.temp_base) + 1.6 * season + rng.normal(0, 0.6, n))

    # Bedtime: chronotype sets the anchor, regularity sets the spread.
    jitter = 0.16 + 0.85 * (1.0 - regularity)
    bedtime = _clip("bedtime_hour", (
        22.06
        + 0.95 * chrono
        - 0.011 * (age - 30.0)
        + 0.006 * (stress - 40.0)
        + 0.007 * (screen - 45.0)
        + is_weekend * 0.55
        + rng.normal(0.0, jitter, n)
    ))

    # --- Sequential state ----------------------------------------------------
    duration = np.zeros(n)
    caffeine = np.zeros(n)
    resting_hr = np.zeros(n)
    snooze = np.zeros(n)
    response = np.zeros(n)
    wake_success = np.zeros(n, dtype=int)
    wake_minute = np.zeros(n)       # actual wake clock time, minutes past midnight
    debt = 0.0                      # running sleep debt, drives caffeine and HR

    for t in range(n):
        # Caffeine is a response to yesterday's debt, not an independent draw.
        caffeine[t] = _clip("caffeine_mg", (
            float(person.caffeine_habit)
            + 26.0 * max(debt, 0.0)
            + 0.22 * (stress[t] - 40.0)
            - is_weekend[t] * 15.0
            + rng.normal(0.0, 22.0)
        ))

        resting_hr[t] = _clip("resting_hr", (
            64.8
            - 13.0 * fitness
            + 0.07 * (age - 30.0)
            + 0.045 * (stress[t] - 40.0)
            + 1.9 * max(debt, 0.0)
            + 0.10 * (temp[t] - 21.0)
            + float(person.hr_base)
            + rng.normal(0.0, 1.8)
        ))

        # Sleep onset latency, in hours, from the classic hygiene factors.
        latency = (
            0.14
            + screen[t] / 300.0
            + caffeine[t] / 1500.0
            + stress[t] / 650.0
            + max(0.0, noise[t] - 35.0) / 150.0
            + max(0.0, abs(temp[t] - 20.5) - 1.5) / 16.0
            - exercise[t] / 1100.0
        )
        latency = float(np.clip(latency + rng.normal(0, 0.06), 0.03, 2.2))

        # Time awake after falling asleep: noise and heat fragment the night,
        # daytime exertion consolidates it.
        fragmentation = float(np.clip(
            0.10
            + max(0.0, noise[t] - 38.0) / 85.0
            + max(0.0, abs(temp[t] - 20.5) - 2.0) / 12.0
            + stress[t] / 1400.0
            + max(0.0, age - 45.0) / 400.0
            - exercise[t] / 900.0
            + rng.normal(0, 0.09),
            0.0, 2.0,
        ))

        # What the alarm allows, versus what the body would take unprompted.
        alarm_hour = float(person.alarm_hour) + (1.2 if is_weekend[t] else 0.0)
        time_in_bed = (alarm_hour + 24.0) - bedtime[t]
        available = time_in_bed - latency - fragmentation
        natural = (
            float(person.sleep_need)
            + 0.45 * max(debt, 0.0)          # rebound sleep after a deficit
            - latency
            - fragmentation
            + rng.normal(0.0, 0.35)
        )
        slept = natural if free_morning[t] else min(available, natural)
        duration[t] = float(np.clip(slept, 3.5, 11.0))

        # --- Waking up -------------------------------------------------------
        # Sleep inertia: short of your own need, in debt, and dragged out of bed
        # before your circadian morning.
        deficit = max(0.0, float(person.sleep_need) - duration[t])
        circadian_pull = max(0.0, (bedtime[t] + duration[t] + latency) - (alarm_hour + 24.0))
        groggy = float(np.clip(
            0.42 * deficit
            + 0.22 * max(debt, 0.0)
            + 0.30 * circadian_pull
            + 0.006 * (stress[t] - 40.0)
            - 0.35 * float(person.resilience)
            + rng.normal(0.0, 0.16),
            -0.5, 3.5,
        ))

        if free_morning[t]:
            snooze[t] = 0.0
            response[t] = _clip("alarm_response_ms", rng.lognormal(np.log(3800), 0.5))
            wake_success[t] = 1
            wake_minute[t] = ((bedtime[t] + duration[t] + latency) % 24.0) * 60.0
        else:
            rate = float(np.clip(0.30 + 1.55 * max(groggy, 0.0), 0.02, 6.0))
            snooze[t] = float(np.clip(rng.poisson(rate), *RANGES["snooze_count"]))
            response[t] = _clip("alarm_response_ms", rng.lognormal(
                np.log(4700.0) + 0.95 * max(groggy, 0.0), 0.55
            ))
            logit = (
                1.55
                - 1.95 * max(groggy, 0.0)
                - 0.30 * snooze[t]
                - 1.20 * (response[t] / 30000.0)
                + 1.10 * float(person.resilience)
                - 0.010 * (stress[t] - 40.0)
            )
            wake_success[t] = int(rng.random() < 1.0 / (1.0 + np.exp(-logit)))
            # Each snooze cycle pushes the real wake time ~9 minutes later.
            wake_minute[t] = (alarm_hour * 60.0 + snooze[t] * 9.0 + response[t] / 60000.0) % 1440.0

        debt = float(np.clip(
            0.55 * debt + (float(person.goal_hours) - duration[t]), -2.0, 4.5
        ))

    midpoint_minute = ((bedtime + duration / 2.0) % 24.0) * 60.0

    return {
        "alarm_set": ~free_morning,
        "bedtime_hour": bedtime,
        "screen_minutes_before_bed": screen,
        "caffeine_mg": caffeine,
        "exercise_minutes": exercise,
        "stress_level": stress,
        "ambient_noise_db": noise,
        "room_temp_c": temp,
        "resting_hr": resting_hr,
        "steps": steps,
        "duration": duration,
        "snooze": snooze,
        "response": response,
        "wake_success": wake_success,
        "wake_minute": wake_minute,
        "midpoint_minute": midpoint_minute,
    }


def _emit_rows(pid: int, person: pd.Series, sim: dict[str, np.ndarray]) -> list[dict]:
    """Turn one simulated person into supervised rows.

    Each row is the prediction the app makes at bedtime for night `n`:

    *   context features come from night `n` itself - the caffeine drunk that
        day, the screen time that evening, the bedroom right now, the planned
        bedtime. All of it is known before the user falls asleep, which is when
        `/ai/sleep-prediction` is called.
    *   behavioral features are trailing aggregates over the nights strictly
        before `n`, matching what `buildUserSignals` reads out of MongoDB.
    *   labels are night `n`'s outcome, so nothing in the row is measured after
        the prediction it supervises.
    """
    rows: list[dict] = []
    last = NIGHTS_PER_PERSON - WAKE_HORIZON

    for n in range(WARMUP_NIGHTS, last):
        # A lie-in with no alarm set isn't a wake the app predicts, and scoring
        # it as an automatic success would tie `wake_success` to the weekend --
        # and so to every habit that shifts on a weekend, like screen time.
        # Such nights still count toward the trailing windows below.
        if not sim["alarm_set"][n]:
            continue

        history = slice(max(0, n - WINDOW_NIGHTS), n)

        # Trailing aggregates, mirroring computeMetrics/buildUserSignals.
        consistency = _consistency_score(list(sim["midpoint_minute"][history]))
        debt = float(np.clip(
            float(person.goal_hours) - float(np.mean(sim["duration"][history])), -2.0, 4.0
        ))
        snooze_mean = float(np.round(np.mean(sim["snooze"][history])))
        response_mean = float(np.round(np.mean(sim["response"][history])))

        # Wake regularity is scored on actual wake times over the coming week,
        # which keeps it a distinct quantity from the bedtime regularity fed in
        # as `sleep_consistency`.
        forward = slice(n, n + WAKE_HORIZON)
        rows.append({
            "person_id": pid,
            "night_index": n,
            "age": float(person.age),
            "chronotype_code": float(person.chronotype_code),
            "bedtime_hour": float(sim["bedtime_hour"][n]),
            "screen_minutes_before_bed": float(sim["screen_minutes_before_bed"][n]),
            "caffeine_mg": float(sim["caffeine_mg"][n]),
            "exercise_minutes": float(sim["exercise_minutes"][n]),
            "stress_level": float(sim["stress_level"][n]),
            "ambient_noise_db": float(sim["ambient_noise_db"][n]),
            "room_temp_c": float(sim["room_temp_c"][n]),
            "resting_hr": float(sim["resting_hr"][n]),
            "steps": float(sim["steps"][n]),
            "snooze_count": snooze_mean,
            "alarm_response_ms": response_mean,
            "sleep_consistency": consistency,
            "sleep_debt_hours": debt,
            "sleep_duration": float(sim["duration"][n]),
            "wakeup_consistency": _consistency_score(list(sim["wake_minute"][forward])),
            "wake_success": int(sim["wake_success"][n]),
        })
    return rows


def build_dataset(seed: int = SEED) -> pd.DataFrame:
    """Simulate the panel and return it as the training frame."""
    rng = np.random.default_rng(seed)
    people = _sample_people(rng)

    rows: list[dict] = []
    for pid in range(len(people)):
        sim = _simulate_person(people.iloc[pid], rng)
        rows.extend(_emit_rows(pid, people.iloc[pid], sim))

    df = pd.DataFrame(rows, columns=META_COLUMNS + FEATURE_NAMES + TARGET_COLUMNS)
    for column, places in DECIMALS.items():
        # Whole-number columns are written as ints, so the CSV reads as data
        # rather than as float noise when it's opened in a spreadsheet.
        df[column] = df[column].round(places).astype("int64" if places == 0 else "float64")
    return df


def summarize(df: pd.DataFrame) -> str:
    """Median-vs-default and label-balance report, printed after a build."""
    defaults = {name: default for name, default, _ in FEATURE_SPEC}
    lines = [
        f"rows={len(df)}  people={df.person_id.nunique()}",
        f"{'feature':<26}{'median':>10}{'mean':>10}{'default':>10}{'min':>10}{'max':>10}",
    ]
    for name in FEATURE_NAMES:
        col = df[name]
        lines.append(
            f"{name:<26}{col.median():>10.1f}{col.mean():>10.1f}{defaults[name]:>10.1f}"
            f"{col.min():>10.1f}{col.max():>10.1f}"
        )
    share = float(df.wake_success.mean())
    lines.append(
        f"\nsleep_duration  mean={df.sleep_duration.mean():.2f}h "
        f"sd={df.sleep_duration.std():.2f}"
    )
    lines.append(
        f"wakeup_consistency  mean={df.wakeup_consistency.mean():.1f} "
        f"sd={df.wakeup_consistency.std():.1f}"
    )
    lines.append(f"wake_success    positive share={share:.3f}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(summarize(build_dataset()))
