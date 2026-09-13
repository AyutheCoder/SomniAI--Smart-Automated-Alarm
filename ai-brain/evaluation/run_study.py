"""Regenerate every reported evaluation table from one command.

    python evaluation/run_study.py --out results/

Real-data sections need `SOMNIAI_DATA_DIR` pointing at a directory holding
`lifesnaps.zip` and `pmdata/`; they are skipped if it is absent, so the
simulation half runs anywhere.

Each table lands as a CSV so the paper's figures and numbers trace back to a
file rather than to a console scroll.
"""

from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wake_plan  # noqa: E402
from evaluation import (ablation, matched, planner_eval, scenarios,  # noqa: E402
                        simulation, statistics)

DATA_DIR = os.environ.get("SOMNIAI_DATA_DIR", "")


def _write(df: pd.DataFrame, out_dir: str, name: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.csv")
    df.to_csv(path, index=False)
    print(f"  wrote {path}  ({len(df)} rows)")


def simulation_tables(out_dir: str) -> None:
    print("[1/6] simulation: planner against exhaustive ground truth")
    df = simulation.study(scenarios.SCENARIOS)
    _write(df, out_dir, "simulation_grid")

    summary = pd.DataFrame([{
        "bedtime_optimal": df["bedtime_optimal"].mean(),
        "verdict_correct": df["verdict_correct"].mean(),
        "false_refusals": int(df["false_refusal"].sum()),
        "broken_promises": int(df["broken_promise"].sum()),
        "n": len(df),
    }])
    _write(summary, out_dir, "simulation_summary")
    _write(df.groupby("scenario", as_index=False).agg(
        bedtime_optimal=("bedtime_optimal", "mean"),
        verdict_correct=("verdict_correct", "mean"),
        false_refusals=("false_refusal", "sum"),
        broken_promises=("broken_promise", "sum")), out_dir, "simulation_by_scenario")


def budget_table(out_dir: str) -> None:
    print("[2/6] simulation: iteration-budget sensitivity")
    original = wake_plan._optimize_plan
    rows = []
    try:
        for budget in (3, 4, 6, 8):
            def patched(features, target, max_rounds=budget, _f=original):
                return _f(features, target, max_rounds=max_rounds)
            wake_plan._optimize_plan = patched
            # Ground truth must cover what the planner can reach at this budget.
            df = simulation.study(scenarios.SCENARIOS, max_steps=3 * budget)
            solved = df[df.truth_minimal_levers.notna() & df.planner_promises]
            rows.append({
                "max_rounds": budget,
                "verdict_correct": round(df.verdict_correct.mean(), 3),
                "false_refusals": int(df.false_refusal.sum()),
                "broken_promises": int(df.broken_promise.sum()),
                "bedtime_optimal": round(df.bedtime_optimal.mean(), 3),
                "exactly_minimal": round(
                    (solved.planner_levers == solved.truth_minimal_levers).mean(), 3),
            })
    finally:
        wake_plan._optimize_plan = original
    _write(pd.DataFrame(rows), out_dir, "simulation_budget")


def ablation_tables(out_dir: str) -> None:
    print("[3/6] simulation: ablating the refusal machinery")
    _write(ablation.study(), out_dir, "ablation")
    _write(ablation.attribution_quality(), out_dir, "ablation_attribution")


def _held_out_predictions(work, feats, seeds=range(5)):
    """Held-out frames and their fitted models, one per grouped split."""
    from sklearn.ensemble import RandomForestClassifier

    from training import train_real
    for seed in seeds:
        tr, te = train_real.grouped_split(work, seed=seed)
        m = RandomForestClassifier(n_estimators=200, max_depth=12,
                                   min_samples_leaf=8, random_state=seed,
                                   n_jobs=1).fit(tr[feats], tr.wake_success.astype(int))
        yield te, m


def real_data_tables(out_dir: str) -> None:
    if not DATA_DIR or not os.path.isdir(DATA_DIR):
        print("[4/6] real data: SKIPPED (set SOMNIAI_DATA_DIR)")
        return
    from sklearn.ensemble import RandomForestClassifier

    from datasets import cache, wake_proxy
    from training import train_real

    print("[4/6] real data: calibration")
    ls = wake_proxy.wake_success(
        cache.lifesnaps_cached(os.path.join(DATA_DIR, "lifesnaps.zip")))
    feats = [c for c in train_real.available_features(ls) if c != "stress_level"]
    work = ls.dropna(subset=feats + ["wake_success"]).reset_index(drop=True)

    truths, probs = [], []
    for seed in range(5):
        tr, te = train_real.grouped_split(work, seed=seed)
        m = RandomForestClassifier(n_estimators=200, max_depth=12, min_samples_leaf=8,
                                   random_state=seed, n_jobs=1).fit(
            tr[feats], tr.wake_success.astype(int))
        truths.append(te.wake_success.astype(int).values)
        probs.append(m.predict_proba(te[feats])[:, list(m.classes_).index(1)])
    y = pd.concat([pd.Series(t) for t in truths], ignore_index=True)
    p = pd.concat([pd.Series(v) for v in probs], ignore_index=True)
    _write(planner_eval.calibration_table(y, p), out_dir, "calibration_table")
    _write(pd.DataFrame([planner_eval.calibration_error(y, p)]), out_dir,
           "calibration_summary")

    print("[5/6] real data: refusal quality")
    frames = []
    for seed in range(3):
        tr, te = train_real.grouped_split(work, seed=seed)
        m = RandomForestClassifier(n_estimators=200, max_depth=12, min_samples_leaf=8,
                                   random_state=seed, n_jobs=1).fit(
            tr[feats], tr.wake_success.astype(int))
        with planner_eval.planner_using(m, feats):
            frames.append(planner_eval.refusal_evaluation(
                te, feats, targets=(0.70, 0.80, 0.90, 0.95),
                max_nights_per_participant=8))
    _write(pd.concat(frames).groupby(["planner", "target"], as_index=False)
             .mean(numeric_only=True), out_dir, "refusal_quality")

    print("[6/7] real data: matched subset")
    _write(matched.study(te, feats, m), out_dir, "matched_subset")

    print("[7/7] real data: statistics with uncertainty")
    pooled = pd.concat([
        pd.DataFrame({"participant_id": t.participant_id.values,
                      "y_true": t.wake_success.astype(int).values,
                      "y_prob": mm.predict_proba(t[feats])[:, list(mm.classes_).index(1)]})
        for t, mm in _held_out_predictions(work, feats)], ignore_index=True)
    _write(statistics.calibration_with_uncertainty(pooled, n_boot=800), out_dir,
           "calibration_uncertainty")

    reg = train_real.repeated_evaluation(ls, features=feats, seeds=tuple(range(8)))
    cls = train_real.repeated_classification(ls, features=feats, seeds=tuple(range(8)))
    _write(pd.DataFrame(
        [statistics.across_splits(reg[m], m) for m in ("mae", "rmse", "r2")] +
        [statistics.across_splits(cls[m], m)
         for m in ("roc_auc", "balanced_accuracy", "accuracy")]),
        out_dir, "across_splits")

    icc = pd.DataFrame([statistics.unconditional_icc(ls, o)
                        for o in ("sleep_duration_hours", "wake_success")])
    _write(icc, out_dir, "intraclass_correlation")

    lin = statistics.mixed_linear(ls, "sleep_duration_hours", feats)
    _write(lin["coefficients"], out_dir, "mixed_effects_sleep_duration")
    log = statistics.clustered_logistic(ls, "wake_success", feats)
    _write(log["coefficients"], out_dir, "gee_wake_regularity")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="results", help="directory for the CSVs")
    ap.add_argument("--skip-real", action="store_true",
                    help="simulation tables only")
    ap.add_argument("--figures", default="figures",
                    help="directory for the paper figures")
    args = ap.parse_args()

    simulation_tables(args.out)
    budget_table(args.out)
    ablation_tables(args.out)
    if not args.skip_real:
        real_data_tables(args.out)
    print("\n[figures] regenerating paper figures")
    from evaluation import ablation as _abl
    from evaluation import figures as _figs
    print("  " + _figs.fig_inverse_search(args.figures))
    print("  " + _figs.fig_synthetic_vs_real(args.figures))
    print("  " + _figs.fig_ablation(args.figures, _abl.study()))

    print(f"\ndone -> {os.path.abspath(args.out)}"
          f" and {os.path.abspath(args.figures)}")


if __name__ == "__main__":
    main()
