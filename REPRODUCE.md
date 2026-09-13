# Reproducing the results

Everything reported in `paper/draft.md` regenerates from this repository. The
simulation results need no downloads at all; the real-data results need two
public cohorts, neither of which requires an application.

## Quick version

```bash
cd ai-brain
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements-lock.txt
python reproduce.py
```

That checks the environment, runs the test suite, regenerates every table and
figure, and compares the output against the values the paper quotes. It exits
non-zero if anything diverges, so it is usable in CI rather than only by eye.

**Windows: clone to a short path such as `C:/somniai`.** numpy ships test
fixtures nested deeply enough that a long clone path pushes the install past the
260-character `MAX_PATH` limit. pip fails partway through and the next import
reports `No module named 'numpy._utils'`, which looks like a broken package and
is not. This was found by running the instructions on a fresh clone rather than
by reasoning about them.

## With the real cohorts

The two datasets are ~2 GB together and are not redistributed here — both are
better fetched from their own archives, and neither needs approval.

```bash
python fetch_datasets.py --out data/external
python -c "import zipfile; zipfile.ZipFile('data/external/pmdata.zip').extractall('data/external')"
export SOMNIAI_DATA_DIR=$PWD/data/external     # set SOMNIAI_DATA_DIR=... on Windows
python reproduce.py
```

`fetch_datasets.py` resumes interrupted downloads, verifies both sizes and
archive integrity, and prints the citation each dataset requires.

**If LifeSnaps fails with `HTTP Error 504: Gateway Time-out`, that is Zenodo,
not you.** The whole record page returns 504 during an outage, not just the
file, so there is nothing to fix locally — wait and retry. Observed on
2026-09-13 across three attempts. PMData is hosted separately at
`datasets.simula.no` and is unaffected, so the simulation results and anything
PMData-only still run. If the outage persists, the archive can be fetched by
hand from <https://zenodo.org/records/7229547> (`rais_anonymized.zip`, 615 MB)
and dropped into `data/external/` under that name.

| Dataset | Source | Licence | Cite |
| --- | --- | --- | --- |
| LifeSnaps | Zenodo record 7229547 | CC BY 4.0 | Yfantidou et al., *Scientific Data* 9:663, 2022 |
| PMData | datasets.simula.no/pmdata | see source | Thambawita et al., *MMSys* 2020 |

**First run is slow.** LifeSnaps hides sleep timing in a 9.7 GB MongoDB dump,
and parsing it takes ~5 minutes. The result is cached to CSV, so subsequent runs
read it in well under a second. Deleting `data/external/cache/` is always safe.

## What determinism rests on

- **Seeds are fixed everywhere.** Every `default_rng` and every `random_state`
  takes an explicit seed; there is no unseeded randomness in the analysis path.
- **Splits are by participant**, with a fixed seed per split, and all reported
  figures are means over eight splits rather than whichever split ran last.
- **Versions are pinned** in `requirements-lock.txt` to exactly what produced the
  reported numbers. `requirements.txt` and `requirements-research.txt` carry
  ranges instead, which is right for running the service and for ongoing work.
- **`powell`, not `lbfgs`, for mixed-effects models.** On this data lbfgs reports
  successful convergence while sitting on the boundary with a between-participant
  variance of exactly zero. Every model result carries a `boundary_solution`
  flag for that reason.

## Runtimes

Measured on a laptop, single-threaded where it matters:

| Stage | Time |
| --- | --- |
| Test suite (`pytest`) | ~4 min |
| Full suite including `-m slow` | ~8 min |
| Simulation tables, ablation, figures | ~7 min |
| Real-data tables (first run, parsing LifeSnaps) | ~12 min |
| Real-data tables (cached) | ~4 min |

## Where each reported number comes from

| Claim | Table | Section |
| --- | --- | --- |
| Synthetic vs real R² | `results/…` via `training/train_real.py` | `docs/sleep-duration-results.md` |
| Wake-regularity AUC | same | `docs/wake-regularity-results.md` |
| Calibration, ECE | `results/calibration_*.csv` | `docs/calibration-refusal-results.md` |
| Refusal quality | `results/refusal_quality.csv` | same |
| Soundness, sweep optimality | `results/simulation_*.csv` | `docs/simulation-validation-results.md` |
| Ablations | `results/ablation.csv` | `docs/ablation-matched-results.md` |
| Matched subset | `results/matched_subset.csv` | same |
| Intervals, ICC, mixed models | `results/across_splits.csv`, `intraclass_correlation.csv` | `docs/statistics-results.md` |

## Tests

311 tests cover the pipeline. The ones that matter most are the ones asserting
properties that would otherwise fail silently:

- participant splits are disjoint, checked across 15 seeds;
- outcome columns cannot become predictors (`assert_no_leakage`);
- habit features use strictly prior nights (`TestNoLeakage`);
- ground truth is graded against the honest lever set, not an ablated one;
- the figure palette survives greyscale conversion.

Full-grid simulation studies are marked `slow` and deselected by default, since
they duplicate what `run_study.py` reports:

```bash
pytest              # fast suite
pytest -m slow      # exhaustive studies
pytest -m ""        # everything
```
