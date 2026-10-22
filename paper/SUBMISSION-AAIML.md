# AAIML 2027 submission package

Target: **IEEE AAIML 2027**, 2nd International Conference on Advances in
Artificial Intelligence and Machine Learning, Nihon University (Surugadai
Campus), Tokyo, 29–31 March 2027.

Confirmed against <https://www.aaiml.net/sub.html> and the EasyChair CFP on
2026-10-01.

## The rules

| | |
| --- | --- |
| **Deadline** | **10 October 2026** |
| Notification | 10 November 2026 |
| Registration deadline | 30 November 2026 |
| **Page limit** | **6 pages free**; up to 4 extra at **USD 70/page**; 10 absolute max |
| Review | **Double-blind.** Submissions must be anonymised, and authors' own prior work may not be cited in an identifying way |
| Format | IEEE conference template (Word and LaTeX provided) |
| System | EasyChair, `easychair.org/conferences/?conf=aaiml2027` |
| Publication | IEEE Xplore, submitted to Scopus and Ei Compendex |
| Originality | "must be original and not simultaneously submitted to another journal or conference" |
| Contact | aaiml_conf@163.com |

**Track fit:** primary is Track 1, *Innovations in Machine Learning Algorithms*,
under Explainable AI. Secondary is Track 3, *Applications of AI and Machine
Learning Across Industries*, under Healthcare. Submit against Track 1 — the
contribution is a recourse/inversion method, and the sleep task is the testbed.

## Two cost items that are easy to miss

**Extra pages are USD 70 each.** 6 pages is the free limit. If the build comes
in at 7 pages that is $70, at 8 pages $140. Trim rather than pay unless the
trimming costs something real.

**Publication requires paid registration.** "Accepted *and registered* full
papers will be published in IEEE Xplore." Budget for the registration fee before
submitting, because an accepted paper that is not registered does not appear.

## Why this version differs from `ichi2027.tex`

Same research, same numbers, reframed for an AI/ML audience rather than a health
informatics one, and cut from 8 pages to fit 6.

| | ICHI version | AAIML version |
| --- | --- | --- |
| Framing | sleep planning, infeasibility-first | model inversion and recourse, sleep as testbed |
| Title | Reliability-Targeted Bedtime Planning | Reliability-Targeted Model Inversion |
| Leads with | the sleep problem | the gap in the recourse literature |
| Results order | synthetic gap first | **algorithmic validation first**, then ablation |
| Keywords | sleep, wearable sensing, health informatics | explainable AI, recourse, counterfactual explanation |
| Tables | 9 | 4 |
| Figures | 6 | 2 |

**What was cut**, all of it detail an ML audience needs less of: the lever
parameter table, the cohort table, the calibration bin table, the matched-subset
table and the target-sensitivity table, all compressed into prose; and the
calibration, splits, ablation and refusal figures, whose numbers survive in the
tables.

**What was deliberately kept**, because cutting it would make the paper
dishonest rather than shorter:

- forward prediction beating our method at every target, and why
- PMData failing to replicate, named as a failed replication
- the horizon partition being simulation-only while also being the headline
- the target having no association with wellbeing
- the whole limitations section

## Files

| File | What it is |
| --- | --- |
| `aaiml2027.tex` | The submission. IEEEtran, double-blind. |
| `figures/fig1_inverse_search.pdf` | The mechanism, feasible vs infeasible |
| `figures/fig2_synthetic_vs_real.pdf` | The synthetic-to-real gap |
| `ichi2027.tex` | The 8-page health-informatics version, kept for ICHI's regular track |

`~/Desktop/aaiml-upload.zip` holds exactly the three files needed to compile.

## Build

No LaTeX locally, so this is **structurally validated but never compiled**:
balanced environments and braces, no dangling `\ref`, no undefined `\cite`, no
uncited bibitem, both figures present. Upload the zip to Overleaf and compile.

```
pdflatex aaiml2027 && pdflatex aaiml2027
```

**Expect 6 to 7 pages.** Body text is ~3,600 words against the ICHI version's
~4,550. If it lands at 7, trim in this order before paying $70:

1. The target-construction paragraph in III-E — the sensitivity numbers can go,
   keeping one sentence that the sweep was run.
2. Algorithm 2's prose — the pseudocode carries most of it.
3. The calibration subsection — compress to the ECE and Brier figures plus the
   "calibrated but weakly informative" sentence.
4. Cohort detail in III-E — participant counts can live in one line.

Do **not** trim the limitations section, and do not drop the forward-prediction
row from Table IV. Both are load-bearing for the paper's credibility.

## Before submitting

- [ ] **Compile and check the page count.**
- [ ] **Check the author block reads "Anonymous Authors"** in the built PDF, not
      just in the source. `\anontrue` is set.
- [ ] **Scrub PDF metadata** — the `\pdfinfo` block handles it, but verify.
- [ ] **EasyChair account**, and submit against Track 1.
- [ ] The artifact URL is already the anonymised mirror. Do not paste the GitHub
      link.
- [ ] No self-citations anywhere — verified, the bibliography is all third-party.

## Sequencing note

AAIML notifies on **10 November 2026**. ICHI 2027's regular track deadline falls
around **February 2027**. So the order works: if AAIML rejects, `ichi2027.tex`
goes to ICHI's regular track with time to spare. If AAIML accepts, the work is
published and ICHI is off the table, because the same work cannot go to both.

That is a real decision rather than a formality. AAIML is a second-edition
conference; ICHI is in its fifteenth and is the stronger venue for this work on
reputation. AAIML is the faster and more probable acceptance.
