# Submission package

Target: **IEEE ICHI 2027, Early Bird track.**
Confirmed against the venue's own CFP on 2026-09-13.

## The rules, confirmed

Source: <https://ichi2027.github.io/ICHI2027/call-for-early-submission.html>

| | |
| --- | --- |
| **Deadline** | **21 Sep 2026, 23:59 AoE** (= 22 Sep 11:59 UTC) |
| Notification | 14 Nov 2026 (intended) |
| Conference | 11–14 Jun 2027, Washington, DC |
| **Page limit** | **10 pages for the main paper, _plus_ references** |
| Review | **Double-blind.** Anonymise the manuscript and blind any references, links, or repositories revealing authorship |
| Format | IEEE Proceedings Format |
| System | OpenReview — IEEE ICHI 2027 |
| Track | **Long papers only.** No short papers in Early Bird |
| If rejected | May revise and resubmit to the regular track |
| AI disclosure | Not mentioned in this CFP |
| Contact | yuzhou.chen@ucr.edu |

**References do not count toward the 10 pages.** This is more generous than the
ICHI 2026 page said ("10 pages including references"), and it is the rule that
applies. The package was built to the stricter reading, so it has room rather
than a problem.

## Why submitting to Early Bird is close to free

The resubmission rule is the whole argument. Accepted, and you are done six
months early with a November decision. Rejected, and you get expert reviews on a
paper no stranger has read, then resubmit to the regular track having addressed
them. The only real cost is the formatting work, which had to happen anyway.

The one risk worth naming: a rejection is a rejection, and if regular-track
reviewers overlap with Early Bird reviewers, a weak first impression can carry.
That argues for submitting a clean paper, not for not submitting.

## Files

| File | What it is |
| --- | --- |
| `ichi2027.tex` | The submission. IEEEtran, `conference` class, double-blind. |
| `figures/*.pdf` | Vector figures, copied from `/figures` (regenerable). |
| `draft.md` | The Markdown source of record. Edit both, or edit here and port. |
| `references.md` | Reference audit — every citation checked against the publisher record. |

## Build

There is **no LaTeX toolchain on this machine**, so `ichi2027.tex` has been
checked structurally but **never compiled**. It passes: balanced environments and
braces, no dangling `\ref`, no undefined `\cite`, no uncited bibitem, every
`\includegraphics` target present. That is not the same as compiling.

Easiest path: upload `paper/` to Overleaf and compile there.

```
pdflatex ichi2027 && pdflatex ichi2027
```

**Page count is still unverified, but the risk is now small.** Estimate: ~4,250
words of body text, 8 tables, 4 figures, 2 algorithms — roughly 9 pages of main
content, with references excluded from the limit. If it overruns 10, trim in
this order:

1. Table `tab:calib` (calibration bins) — the ECE figure in the text carries the
   result; the four-row table is a nicety.
2. The parameter table's threshold block — move to the artifact, referenced.
3. Fig. `fig:ablation` — Table `tab:ablation` already reports every number in it.
4. Section III-D's derived-feature paragraph — compress to two sentences.

Do **not** trim the limitations section to make space. It is load-bearing for
this paper's argument, and cutting it is how the paper stops being honest.

If it comes in comfortably under 10, consider restoring `fig3_calibration.pdf`
(the reliability diagram) — it is the most persuasive single image in the set
and it is currently cut.

## Before submitting

- [ ] **Compile it.** Check page count, check no figure lands on a page alone,
      check no table is overfull.
- [ ] **Authorship.** Settle the author list and order with the co-author who
      wrote the original system — before submission, not after.
- [ ] **Anonymise the artifact.** The CFP explicitly requires blinding
      "references, links, repositories, or other information that could reveal
      authorship." The repo is public under a real name and `REPRODUCE.md` names
      it. Use an anonymising proxy (e.g. `anonymous.4open.science`) and put that
      URL in the Reproducibility footnote, replacing the placeholder.
- [ ] **Scrub the PDF metadata.** LaTeX embeds the author name from the system
      unless told otherwise. Under double-blind this deanonymises you silently.
- [ ] **Check the paper for self-identifying phrasing** — "our previously
      released app", the project name, anything that points at the repository.
- [ ] **AI disclosure.** This CFP does not mention it, but IEEE's general
      policy on generative-AI use in submissions still applies. Disclose in the
      acknowledgements if required by the publication agreement.
- [ ] **OpenReview account** set up ahead of the deadline, not on the night.

## arXiv: post it, but afterwards

**Do not post the preprint before the submission goes in.** The track is
double-blind and requires blinding anything that reveals authorship; a named
preprint posted days before the deadline works against that. Most venues permit
arXiv preprints, but the safe sequencing costs nothing:

1. Submit to ICHI (21 Sep).
2. Then post to arXiv, with the real author block restored.

Category: `cs.LG` primary, cross-list `cs.HC` and `eess.SP`. Licence: CC BY 4.0,
compatible with LifeSnaps' licence and keeps the preprint reusable.

The preprint should differ from the submission in exactly two ways: real authors,
and the real repository URL instead of the anonymised proxy.

## Cover letter

A conference submission usually has no cover-letter field — this is for the
optional *comments to the chairs* box, and for the journal path if the paper is
recommended onward. Trimmed to fit a text box:

> We submit *Reliability-Targeted Bedtime Planning with Explicit Infeasibility*
> to the ICHI 2027 Early Bird track.
>
> The paper inverts a trained sleep model against a required reliability rather
> than reading it forward, and treats infeasibility — the case where no
> admissible plan reaches the target — as a first-class output with
> counterfactual attribution rather than as a failed search. The nearest prior
> work is algorithmic recourse; we differ in that the constraint is a required
> probability rather than a decision boundary, and in that our feature partition
> is temporal rather than binary, separating what a person can change tonight
> from what is changeable only over weeks.
>
> Two aspects of the evaluation warrant flagging to reviewers in advance, since
> both are unusual and both are deliberate.
>
> First, we report that a physiologically-structured synthetic panel overstates
> predictability on this task by roughly a factor of four in R². We developed
> our own system against such a panel, so this is a finding about our own prior
> work as much as about the practice generally, and we report it because
> training sleep models on simulated data is common.
>
> Second, we report a baseline that outperforms our method. Forward prediction,
> using the same model without search, achieves a lower over-promise rate at
> every target. We include it because omitting it would be selective reporting;
> we explain in Section IV-D why the two are making different kinds of claim and
> why observational data can check one but not the other.
>
> The central limitation is stated plainly throughout: there is no deployment
> study, and the end-to-end claim that following the advice improves waking is
> not established. All results regenerate from the artifact, which is available
> at an anonymised URL.
