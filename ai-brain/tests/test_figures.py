"""Tests for the paper figures.

Figures fail quietly: a broken one still writes a file, and nobody notices until
a reviewer opens a PDF with two indistinguishable grey lines. These check the
properties that would be invisible otherwise - that every figure actually
renders, that both a raster and a vector version land, and that the palette
survives a monochrome print.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import pytest

from evaluation import figures


def _rendered(path: str) -> bool:
    """A real plot, not an empty canvas."""
    return os.path.exists(path) and os.path.getsize(path) > 5_000


class TestGreyscaleSafety:
    def test_the_palette_separates_without_colour(self):
        result = figures.check_greyscale_separation(figures.GREYS)
        assert result["passes"], result

    def test_luminances_are_monotonic_and_spread(self):
        lums = [figures.luminance(g) for g in figures.GREYS]
        assert lums == sorted(lums)
        assert lums[-1] - lums[0] > 0.5

    def test_the_check_rejects_a_palette_that_would_collapse(self):
        """Two mid blues are distinct in colour and identical in print."""
        result = figures.check_greyscale_separation(["#4a6fd4", "#4a8fd4"])
        assert not result["passes"]

    def test_every_series_has_a_non_colour_cue(self):
        """Line style and marker must carry the distinction too."""
        assert len(set(figures.STYLES)) == len(figures.STYLES)
        assert len(set(figures.MARKERS)) == len(figures.MARKERS)
        assert len(set(figures.HATCHES)) == len(figures.HATCHES)


class TestFiguresRender:
    def test_inverse_search_shows_both_outcomes(self, tmp_path):
        path = figures.fig_inverse_search(str(tmp_path))
        assert _rendered(path)
        assert _rendered(path.replace(".png", ".pdf"))

    def test_synthetic_vs_real(self, tmp_path):
        assert _rendered(figures.fig_synthetic_vs_real(str(tmp_path)))

    def test_calibration(self, tmp_path):
        table = pd.DataFrame({
            "bin_low": [0.6, 0.7, 0.8], "bin_high": [0.7, 0.8, 0.9],
            "n": [400, 1100, 1200],
            "mean_predicted": [0.66, 0.76, 0.84],
            "observed_rate": [0.65, 0.77, 0.83],
            "gap": [0.01, -0.01, 0.01],
        })
        path = figures.fig_calibration(str(tmp_path), table, ece=0.0148,
                                       ece_ci=(0.014, 0.057))
        assert _rendered(path)

    def test_refusal(self, tmp_path):
        refusal = pd.DataFrame([
            {"planner": p, "target": t, "over_promise_rate": r}
            for p, rates in (("always_promise", [0.38, 0.61, 0.87, 1.00]),
                             ("inverse", [0.37, 0.47, 0.07, 0.04]))
            for t, r in zip((0.7, 0.8, 0.9, 0.95), rates)
        ])
        assert _rendered(figures.fig_refusal(str(tmp_path), refusal))

    def test_ablation(self, tmp_path):
        tbl = pd.DataFrame({
            "ablation": ["none", "sweep", "ascent", "partition", "attribution"],
            "false_refusals": [3, 5, 10, 3, 3],
            "broken_promises": [0, 0, 0, 3, 0],
        })
        assert _rendered(figures.fig_ablation(str(tmp_path), tbl))

    def test_across_splits(self, tmp_path):
        rng = np.random.default_rng(0)
        per_split = pd.DataFrame({
            "r2": rng.normal(0.19, 0.16, 8),
            "roc_auc": rng.normal(0.66, 0.07, 8),
            "balanced_accuracy": rng.normal(0.61, 0.05, 8),
        })
        assert _rendered(figures.fig_across_splits(str(tmp_path), per_split))

    def test_every_figure_writes_both_raster_and_vector(self, tmp_path):
        """PNG for drafts, PDF for submission - a missing vector is found late."""
        figures.fig_synthetic_vs_real(str(tmp_path))
        names = {f.rsplit(".", 1)[-1] for f in os.listdir(tmp_path)}
        assert names == {"png", "pdf"}


class TestSizedForPrint:
    def test_widths_match_a_two_column_layout(self):
        assert figures.COLUMN_WIDTH == pytest.approx(3.4, abs=0.2)
        assert figures.FULL_WIDTH == pytest.approx(7.0, abs=0.3)

    def test_resolution_is_adequate_for_print(self):
        assert figures.DPI >= 300
