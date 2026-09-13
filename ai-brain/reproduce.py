"""One command that regenerates every number and figure in the paper.

    python reproduce.py

Checks the environment, runs the test suite, regenerates every table and figure,
and reports which reported values matched. Exits non-zero if anything a reviewer
would care about fails, so it is usable in CI rather than only by eye.

Without SOMNIAI_DATA_DIR the real-data sections are skipped and the simulation
half still runs end to end - the algorithm validation, the ablations and the
budget sensitivity need no downloads at all.

On Windows, clone to a short path such as C:/somniai. numpy ships test fixtures
nested deeply enough that a long clone path pushes the install past the 260
character MAX_PATH limit, and pip fails partway through with a misleading
"No module named numpy._utils" on the next import.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# Values reported in paper/draft.md, with the tolerance each is quoted to.
# A mismatch means the paper and the code have diverged.
EXPECTED = {
    "simulation_summary.csv": [
        ("bedtime_optimal", 1.000, 0.001),
        ("verdict_correct", 0.929, 0.01),
        ("broken_promises", 0.0, 0.001),
        ("false_refusals", 3.0, 0.001),
    ],
}


def _run(label: str, argv: list[str]) -> bool:
    print(f"\n=== {label} ===")
    started = time.perf_counter()
    result = subprocess.run(argv, cwd=HERE)
    ok = result.returncode == 0
    print(f"    {'ok' if ok else 'FAILED'} in {time.perf_counter()-started:.0f}s")
    return ok


def check_environment() -> bool:
    print("=== environment ===")
    ok = True
    if sys.version_info < (3, 11):
        print(f"    Python {sys.version_info.major}.{sys.version_info.minor} "
              "- 3.11+ required")
        ok = False
    else:
        print(f"    Python {sys.version.split()[0]}")

    for module, pinned in (("numpy", "2.4.2"), ("pandas", "3.0.0"),
                           ("sklearn", "1.8.0"), ("statsmodels", "0.15.0"),
                           ("matplotlib", "3.10.8")):
        try:
            version = __import__(module).__version__
            note = "" if version == pinned else f"  (paper used {pinned})"
            print(f"    {module} {version}{note}")
        except ImportError:
            print(f"    {module} MISSING - pip install -r requirements-lock.txt")
            ok = False

    data = os.environ.get("SOMNIAI_DATA_DIR", "")
    if data and os.path.isdir(data):
        print(f"    data: {data}")
    else:
        print("    data: not set - real-data sections will be skipped")
        print("          (see fetch_datasets.py)")
    return ok


def verify_reported(results_dir: str) -> bool:
    """Compare regenerated tables against the values the paper quotes."""
    import pandas as pd

    print("\n=== reported values ===")
    all_ok = True
    for filename, checks in EXPECTED.items():
        path = os.path.join(results_dir, filename)
        if not os.path.exists(path):
            print(f"    {filename}: not generated")
            all_ok = False
            continue
        row = pd.read_csv(path).iloc[0]
        for column, expected, tol in checks:
            actual = float(row[column])
            ok = abs(actual - expected) <= tol
            all_ok &= ok
            print(f"    {'ok  ' if ok else 'DIFF'} {column}: {actual:.3f} "
                  f"(paper: {expected:.3f})")
    return all_ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="results")
    ap.add_argument("--figures", default="figures")
    ap.add_argument("--skip-tests", action="store_true")
    args = ap.parse_args()

    if not check_environment():
        print("\nenvironment incomplete - see requirements-lock.txt")
        return 1

    ok = True
    if not args.skip_tests:
        ok &= _run("test suite", [sys.executable, "-m", "pytest", "-q"])

    ok &= _run("tables and figures",
               [sys.executable, os.path.join("evaluation", "run_study.py"),
                "--out", args.out, "--figures", args.figures])

    ok &= verify_reported(os.path.join(HERE, args.out))

    print("\n" + ("all reproduced" if ok else "SOMETHING DID NOT REPRODUCE"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
