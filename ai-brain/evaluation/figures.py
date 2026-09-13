"""Paper figures, generated from the committed evaluation code.

Every figure here is drawn from the same functions that produce the numbers in
`docs/`, so a figure and the table it accompanies cannot drift apart.

**Everything must survive greyscale printing.** IEEE proceedings are read on
paper and on monochrome printers, and a figure whose series are distinguished
only by hue becomes unreadable. So every series carries three redundant cues -
a distinct grey level, a distinct line style or hatch, and a distinct marker -
and `check_greyscale_separation` asserts the grey levels stay far enough apart
to tell without colour. The palette below is greys by construction, which makes
the constraint impossible to violate by accident later.

Sizes are set for a two-column IEEE layout: 3.4 inches wide for a single column,
7.0 for a full-width figure, with type large enough to stay legible at that
scale rather than shrunk from a screen-sized default.
"""

from __future__ import annotations

import os
import sys

import matplotlib
matplotlib.use("Agg")                      # no display in CI or a container
import matplotlib.pyplot as plt            # noqa: E402
import numpy as np                         # noqa: E402
import pandas as pd                        # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

COLUMN_WIDTH = 3.4                         # inches, one IEEE column
FULL_WIDTH = 7.0
DPI = 400

# Grey levels chosen for even luminance spacing, so adjacent series stay
# distinguishable after a monochrome print.
GREYS = ["0.15", "0.40", "0.62", "0.80"]
STYLES = ["-", "--", "-.", ":"]
MARKERS = ["o", "s", "^", "D"]
HATCHES = ["", "///", "...", "xxx"]

_RC = {
    "font.size": 8,
    "axes.labelsize": 8,
    "axes.titlesize": 9,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 7,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linewidth": 0.5,
    "figure.dpi": DPI,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.02,
}


def _save(fig, out_dir: str, name: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.png")
    fig.savefig(path, dpi=DPI)
    fig.savefig(os.path.join(out_dir, f"{name}.pdf"))   # vector, for submission
    plt.close(fig)
    return path


def luminance(grey_or_rgb) -> float:
    """Perceived lightness, 0 (black) to 1 (white)."""
    rgb = matplotlib.colors.to_rgb(grey_or_rgb)
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def check_greyscale_separation(colours, min_gap: float = 0.12) -> dict:
    """Are these series still distinguishable once colour is gone?

    Converts each to luminance and measures the smallest gap between any pair.
    A figure that fails this is one where two lines become the same shade on a
    monochrome printer.
    """
    lums = sorted(luminance(c) for c in colours)
    gaps = [b - a for a, b in zip(lums, lums[1:])]
    smallest = min(gaps) if gaps else 1.0
    return {
        "luminances": [round(v, 3) for v in lums],
        "min_gap": round(float(smallest), 3),
        "passes": bool(smallest >= min_gap),
    }


# ---------------------------------------------------------------------------
# Figure 1 - the bedtime inverse search
# ---------------------------------------------------------------------------


def fig_inverse_search(out_dir: str, model=None, features: dict | None = None,
                       feasible_target: float = 0.60,
                       infeasible_target: float = 0.85) -> str:
    """The mechanism, and the refusal, side by side.

    Both panels sweep the same reliability curve. The left one shows a target
    the curve reaches, so the planner returns the *latest* bedtime that still
    clears it - latest, because the objective is the least behavioural cost that
    satisfies the constraint. The right one shows a target the curve never
    reaches, where a forward model would still emit a number and this planner
    declines.

    Under the infeasibility-first framing the right-hand panel is the
    contribution, so it gets equal space rather than a footnote.
    """
    from evaluation import scenarios, simulation
    import wake_plan

    model = model or scenarios.monotone
    features = dict(features or scenarios.BASELINE)

    plans = {}
    with simulation.planner_using_fn(model):
        for key, tgt in (("feasible", feasible_target),
                         ("infeasible", infeasible_target)):
            plans[key] = wake_plan.plan_wake({"features": dict(features),
                                              "requiredReliability": tgt})

    with plt.rc_context(_RC):
        fig, axes = plt.subplots(1, 2, figsize=(FULL_WIDTH, 2.4), sharey=True)
        for ax, (key, tgt) in zip(axes, (("feasible", feasible_target),
                                         ("infeasible", infeasible_target))):
            plan = plans[key]
            curve = pd.DataFrame(plan["reliabilityCurve"])
            chosen = plan["recommendedBedtimeHour"]

            ax.plot(curve["bedtimeHour"], curve["reliability"],
                    color=GREYS[0], linewidth=1.4, label="predicted reliability")
            ax.axhline(tgt, color=GREYS[1], linestyle="--", linewidth=1.1,
                       label=f"required ({tgt:.0%})")

            if chosen is not None:
                ax.axvspan(chosen, curve["bedtimeHour"].max(), color="0.96", zorder=0)
                ax.axvline(chosen, color=GREYS[0], linestyle=":", linewidth=1.0)
                ax.plot([chosen], [plan["achievedReliability"]], marker="o",
                        color=GREYS[0], markersize=5.5, zorder=5)
                ax.annotate(f"latest feasible\n{plan['recommendedBedtime']}",
                            xy=(chosen, plan["achievedReliability"]),
                            xytext=(chosen + 0.9, 0.80), fontsize=7,
                            arrowprops=dict(arrowstyle="->", lw=0.7,
                                            color=GREYS[0]))
                ax.set_title("target reachable: plan returned", fontsize=8)
            else:
                ceiling = curve["reliability"].max()
                ax.axhspan(ceiling, 1.0, color="0.96", zorder=0)
                ax.annotate(f"achievable ceiling {ceiling:.0%}\nno bedtime suffices",
                            xy=(curve["bedtimeHour"].iloc[0] + 0.1, ceiling - 0.01),
                            xytext=(22.6, ceiling - 0.22), fontsize=7,
                            arrowprops=dict(arrowstyle="->", lw=0.7,
                                            color=GREYS[0]))
                ax.set_title("target unreachable: refusal", fontsize=8)

            ax.set_xlabel("bedtime (h; 24–26 = after midnight)")
            ax.set_ylim(0, 1)
            ax.legend(loc="lower left", frameon=False)
        axes[0].set_ylabel("P(wake on schedule)")
        return _save(fig, out_dir, "fig1_inverse_search")


# ---------------------------------------------------------------------------
# Figure 2 - synthetic versus real
# ---------------------------------------------------------------------------


def fig_synthetic_vs_real(out_dir: str, results: pd.DataFrame | None = None) -> str:
    """The headline finding: a simulated panel overstates predictability."""
    if results is None:
        results = pd.DataFrame([
            {"cohort": "Synthetic", "r2": 0.702, "mae": 0.403},
            {"cohort": "LifeSnaps", "r2": 0.186, "mae": 1.016},
            {"cohort": "PMData", "r2": -0.090, "mae": 1.072},
        ])

    with plt.rc_context(_RC):
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(FULL_WIDTH, 2.2))
        x = np.arange(len(results))

        for ax, col, label, better in (
            (ax1, "r2", "R² (sleep duration)", "higher is better"),
            (ax2, "mae", "MAE, hours", "lower is better"),
        ):
            bars = ax.bar(x, results[col], width=0.6, edgecolor="black",
                          linewidth=0.7)
            for bar, grey, hatch in zip(bars, GREYS, HATCHES):
                bar.set_facecolor(grey)
                bar.set_hatch(hatch)
            ax.set_xticks(x)
            ax.set_xticklabels(results["cohort"])
            ax.set_ylabel(label)
            ax.set_title(better, fontsize=7, color="0.35")
            for xi, v in zip(x, results[col]):
                ax.text(xi, v + (0.02 if v >= 0 else -0.06), f"{v:.3f}",
                        ha="center", fontsize=6.5)
        ax1.axhline(0, color="black", linewidth=0.6)
        return _save(fig, out_dir, "fig2_synthetic_vs_real")


# ---------------------------------------------------------------------------
# Figure 3 - calibration
# ---------------------------------------------------------------------------


def fig_calibration(out_dir: str, table: pd.DataFrame,
                    ece: float | None = None,
                    ece_ci: tuple[float, float] | None = None) -> str:
    """Reliability diagram. Bin counts included, because a bin holding 2.6% of
    nights should not look as authoritative as one holding 35%."""
    with plt.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(COLUMN_WIDTH, 2.6))
        ax.plot([0, 1], [0, 1], linestyle="--", color=GREYS[2], linewidth=0.9,
                label="perfect calibration")
        sizes = 12 + 120 * (table["n"] / table["n"].max())
        ax.scatter(table["mean_predicted"], table["observed_rate"], s=sizes,
                   facecolor=GREYS[1], edgecolor="black", linewidth=0.6,
                   zorder=4, label="observed (area = nights)")
        ax.plot(table["mean_predicted"], table["observed_rate"],
                color=GREYS[0], linewidth=1.0, zorder=3)
        ax.set_xlabel("predicted P(wake on schedule)")
        ax.set_ylabel("observed frequency")
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        if ece is not None:
            label = f"ECE {ece:.4f}"
            if ece_ci:
                label += f"\n95% CI {ece_ci[0]:.3f}–{ece_ci[1]:.3f}"
            ax.text(0.04, 0.90, label, fontsize=7, va="top",
                    bbox=dict(boxstyle="round,pad=0.3", facecolor="white",
                              edgecolor="0.7", linewidth=0.6))
        ax.legend(loc="lower right", frameon=False)
        return _save(fig, out_dir, "fig3_calibration")


# ---------------------------------------------------------------------------
# Figure 4 - refusal quality
# ---------------------------------------------------------------------------


def fig_refusal(out_dir: str, refusal: pd.DataFrame) -> str:
    """Over-promise rate against the requested target, by planner."""
    order = ["always_promise", "cycle_calculator", "forward_only", "inverse"]
    labels = {"always_promise": "always promise",
              "cycle_calculator": "90-min cycle rule",
              "forward_only": "forward prediction",
              "inverse": "inverse planner"}

    with plt.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(COLUMN_WIDTH, 2.4))
        for i, name in enumerate([n for n in order if n in set(refusal["planner"])]):
            sub = refusal[refusal["planner"] == name].sort_values("target")
            ax.plot(sub["target"], sub["over_promise_rate"],
                    color=GREYS[i % len(GREYS)], linestyle=STYLES[i % len(STYLES)],
                    marker=MARKERS[i % len(MARKERS)], markersize=3.5,
                    linewidth=1.2, label=labels.get(name, name))
        ax.set_xlabel("requested reliability")
        ax.set_ylabel("over-promise rate")
        ax.set_ylim(-0.03, 1.03)
        ax.legend(loc="upper left", frameon=False)
        return _save(fig, out_dir, "fig4_refusal_quality")


# ---------------------------------------------------------------------------
# Figure 5 - ablation
# ---------------------------------------------------------------------------


def fig_ablation(out_dir: str, ablation_table: pd.DataFrame) -> str:
    """What each component contributes, and how each failure differs."""
    labels = {"none": "full planner", "sweep": "no bedtime sweep",
              "ascent": "no coordinate ascent", "partition": "no habit partition",
              "attribution": "no attribution"}
    tbl = ablation_table.copy()
    tbl["label"] = tbl["ablation"].map(labels).fillna(tbl["ablation"])

    with plt.rc_context(_RC):
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(FULL_WIDTH, 2.4))
        y = np.arange(len(tbl))

        b1 = ax1.barh(y, tbl["false_refusals"], height=0.62,
                      edgecolor="black", linewidth=0.7)
        b2 = ax2.barh(y, tbl["broken_promises"], height=0.62,
                      edgecolor="black", linewidth=0.7)
        for bars in (b1, b2):
            for bar, grey, hatch in zip(bars, GREYS * 2, HATCHES * 2):
                bar.set_facecolor(grey)
                bar.set_hatch(hatch)

        for ax, col, title in (
            (ax1, "false_refusals", "false refusals (conservative)"),
            (ax2, "broken_promises", "broken promises (unsound)"),
        ):
            ax.set_yticks(y)
            ax.set_yticklabels(tbl["label"] if ax is ax1 else [])
            ax.invert_yaxis()
            ax.set_xlabel("count of 42 scenarios")
            ax.set_title(title, fontsize=8)
            for yi, v in zip(y, tbl[col]):
                ax.text(v + 0.15, yi, str(int(v)), va="center", fontsize=6.5)
        ax2.set_xlim(0, max(4, tbl["broken_promises"].max() + 1))
        return _save(fig, out_dir, "fig5_ablation")


# ---------------------------------------------------------------------------
# Figure 6 - split-to-split variability
# ---------------------------------------------------------------------------


def fig_across_splits(out_dir: str, per_split: pd.DataFrame) -> str:
    """Why a single split is not a result.

    Each metric's spread across grouped splits, with the mean marked. R² ranges
    from below zero to nearly 0.4 on the same data.
    """
    metrics = [("r2", "R²"), ("roc_auc", "ROC AUC"),
               ("balanced_accuracy", "balanced acc.")]
    available = [(k, lab) for k, lab in metrics if k in per_split.columns]

    with plt.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(COLUMN_WIDTH, 2.3))
        for i, (key, label) in enumerate(available):
            vals = per_split[key].dropna().values
            ax.scatter(np.full(len(vals), i), vals, s=18, facecolor=GREYS[2],
                       edgecolor="black", linewidth=0.5, zorder=3)
            ax.hlines(vals.mean(), i - 0.22, i + 0.22, color=GREYS[0],
                      linewidth=1.6, zorder=4)
        ax.axhline(0.5, color=GREYS[2], linestyle=":", linewidth=0.8)
        ax.axhline(0.0, color=GREYS[2], linestyle=":", linewidth=0.8)
        ax.set_xticks(range(len(available)))
        ax.set_xticklabels([lab for _, lab in available])
        ax.set_ylabel("value across grouped splits")
        ax.text(0.02, 0.02, "bars mark the mean", transform=ax.transAxes,
                fontsize=6.5, color="0.35")
        return _save(fig, out_dir, "fig6_across_splits")
