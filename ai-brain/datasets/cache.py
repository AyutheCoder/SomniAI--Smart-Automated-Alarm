"""Disk cache for parsed datasets.

Parsing LifeSnaps means streaming a 9.7 GB mongodump to recover 3,551 sleep
records, which takes ~285 seconds. Without a cache every experiment pays that
before doing any work, which made the planner evaluation look pathologically
slow when the planner was not the problem at all.

CSV rather than parquet: no pyarrow in this environment, and at a few thousand
rows the format costs nothing.
"""

from __future__ import annotations

import os

import pandas as pd

from . import lifesnaps, pmdata, schema

DEFAULT_CACHE_DIR = os.environ.get(
    "SOMNIAI_CACHE_DIR",
    os.path.join(os.environ.get("SOMNIAI_DATA_DIR", ""), "cache"),
)

_DATE_COLUMNS = ("date",)


def _read(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    for col in _DATE_COLUMNS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col]).dt.date
    return df


def load_cached(
    name: str,
    builder,
    cache_dir: str | None = None,
    rebuild: bool = False,
) -> pd.DataFrame:
    """Return `builder()`'s frame, caching it under `cache_dir`.

    A cache miss is silent and simply rebuilds, so deleting the directory is
    always safe and never changes results.
    """
    cache_dir = cache_dir or DEFAULT_CACHE_DIR
    path = os.path.join(cache_dir, f"{name}.csv") if cache_dir else None

    if path and not rebuild and os.path.exists(path) and os.path.getsize(path) > 0:
        df = _read(path)
        if list(df.columns) == schema.ALL_COLUMNS:
            return df
        # Schema drifted since the cache was written; rebuild rather than
        # silently training on a stale column set.

    df = builder()
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        df.to_csv(path, index=False)
    return df


def lifesnaps_cached(zip_path: str, cache_dir: str | None = None,
                     rebuild: bool = False) -> pd.DataFrame:
    return load_cached("lifesnaps", lambda: lifesnaps.load(zip_path=zip_path),
                       cache_dir=cache_dir, rebuild=rebuild)


def pmdata_cached(root: str, cache_dir: str | None = None,
                  rebuild: bool = False) -> pd.DataFrame:
    return load_cached("pmdata", lambda: pmdata.load(root),
                       cache_dir=cache_dir, rebuild=rebuild)
