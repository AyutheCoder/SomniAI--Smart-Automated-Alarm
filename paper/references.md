# Reference audit

Every entry in `draft.md`'s reference list, with how it was checked. Nothing here
was written from memory and left unchecked — each was confirmed against the
publisher record, the journal's own page, or the indexed listing, and the
checking date is recorded so a stale verification is visible as stale.

Verified 2026-09-13.

| # | Work | Status | Checked against |
| --- | --- | --- | --- |
| [1] | Wachter, Mittelstadt & Russell 2018 | **verified** | *Harvard JOLT* 31(2):841–887; arXiv 1711.00399 |
| [2] | Ustun, Spangher & Liu 2019 | **verified** | ACM DL, doi 10.1145/3287560.3287566; arXiv 1809.06514 |
| [3] | Mothilal, Sharma & Tan 2020 | **verified** | ACM DL, doi 10.1145/3351095.3372850, pp. 607–617 |
| [4] | Campanella et al. 2024 | **verified** | *Clocks & Sleep* 6(1):183–199, doi 10.3390/clockssleep6010013 |
| [5] | Sathyanarayana et al. 2016 | **verified** | *JMIR mHealth uHealth* 4(4):e125, doi 10.2196/mhealth.6562 |
| [6] | Fellger et al. 2020 | **verified** | *IEEE JTEHM* 8:2700509, doi 10.1109/JTEHM.2020.3014564 |
| [7] | Yfantidou et al. 2022 (LifeSnaps) | **verified** | *Scientific Data* 9:663, doi 10.1038/s41597-022-01764-x |
| [8] | Thambawita et al. 2020 (PMData) | **verified** | ACM MMSys '20, pp. 231–236, doi 10.1145/3339825.3394926 |

## Two details worth carrying into the final version

**[5] has a published correction.** *JMIR mHealth uHealth* 4(4):e130 corrects the
original article. Cite the article; if the correction touches a number we rely
on, cite both. We rely on this work only for the existence of the forward
-prediction literature, so it does not affect any claim of ours.

**[8] has a long author list.** PMData carries well over twenty authors. The
draft lists five and `et al.`; IEEEtran's `\bibliography` handling will need the
full list in the `.bib` so the style file can truncate it consistently rather
than truncating it by hand.

## Deliberate omissions

**No citation for "sleep cycle calculators."** Section 2.2 mentions the 90-minute
subtraction rule. It is a folk rule in consumer apps, not a research method, and
there is no primary source that proposes it as one. It is described as a
model-free rule and used as a baseline (§4.4), not attributed to anyone.

**No citation for the actionable/immutable framing beyond [2].** The recourse
literature has grown considerably since 2019. We cite the paper that introduced
the distinction we build on rather than surveying its descendants; a reviewer
asking for a broader survey is asking for a paragraph, and that is the right
place to add it.
