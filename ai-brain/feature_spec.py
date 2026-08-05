from __future__ import annotations

FEATURE_SPEC: list[tuple[str, float, tuple[float, float]]] = [
    ("age", 30, (16, 70)),
    ("chronotype_code", 1, (0, 2)),          # 0 lark, 1 intermediate, 2 owl
    ("bedtime_hour", 23.0, (20.0, 26.0)),    # 24..26 == 00:00..02:00 next day
    ("screen_minutes_before_bed", 45, (0, 180)),
    ("caffeine_mg", 80, (0, 400)),
    ("exercise_minutes", 30, (0, 120)),
    ("stress_level", 40, (0, 100)),
    ("ambient_noise_db", 35, (20, 70)),
    ("room_temp_c", 22, (14, 30)),
    ("resting_hr", 62, (45, 90)),
    ("steps", 7000, (0, 18000)),
    ("snooze_count", 1, (0, 6)),
    ("alarm_response_ms", 8000, (500, 30000)),
    ("sleep_consistency", 70, (0, 100)),    # 0..100, higher == steadier
    ("sleep_debt_hours", 0.5, (-2.0, 4.0)),
]

FEATURE_NAMES: list[str] = [name for name, _default, _rng in FEATURE_SPEC]
FEATURE_DEFAULTS: dict[str, float] = {name: default for name, default, _rng in FEATURE_SPEC}


def build_feature_vector(payload: dict | None) -> list[float]:
    """Map a partial feature dict to an ordered vector, filling defaults.

    Unknown keys are ignored; missing keys fall back to the schema default, so a
    caller can pass only the signals it actually has.
    """
    payload = payload or {}
    vector: list[float] = []
    for name in FEATURE_NAMES:
        value = payload.get(name, FEATURE_DEFAULTS[name])
        try:
            vector.append(float(value))
        except (TypeError, ValueError):
            vector.append(float(FEATURE_DEFAULTS[name]))
    return vector