# What to put in the EasyChair form — AAIML 2027

Submit at <https://easychair.org/conferences/?conf=aaiml2027>, deadline
**10 October 2026**. Choose the **full paper** route, not the 300-word abstract
route, which is presentation-only and does not reach IEEE Xplore.

**One file is uploaded: the compiled PDF.** Everything else below is typed or
pasted into form fields. No source, no figures, no cover letter.

---

## Title

```
Reliability-Targeted Model Inversion with Explicit Infeasibility
```

## Abstract

Paste the contents of [`abstract-aaiml.txt`](abstract-aaiml.txt) verbatim. It is
296 words, plain text, generated from the `.tex` so it cannot drift from the
paper. Do not retype it, and do not paste the LaTeX version, which contains
`$R^2$` and will render as literal dollar signs.

## Keywords

EasyChair usually wants one per line and at least three. Use the first five:

```
explainable AI
algorithmic recourse
counterfactual explanation
model inversion
calibration
```

## Topic / track

**Innovations in Machine Learning Algorithms**, under Explainable AI. If a
second topic is allowed, add *Applications of AI and Machine Learning Across
Industries* (Healthcare). Lead with the first: the contribution is a method, and
the sleep task is the testbed.

## Authors

**This is where your names go, and the only place they go.** The track is
double-blind, so the PDF stays anonymous while the form records authorship.

The names, e-mails and affiliation are in `paper/authors.local.tex`, which is
gitignored. They are deliberately not written here: this repository is public,
and nothing in a tracked file may identify the authors while the paper is under
double-blind review.

Agree the author **order** before submitting. EasyChair records it, it is what
appears in IEEE Xplore, and changing it later is awkward. Tick one author as
corresponding.

---

## Before you click submit

- [ ] The PDF is **6 pages** and compiled from the current source.
- [ ] The author block in the PDF reads **"Anonymous Authors"**. Open the PDF and
      look, rather than trusting that `\anontrue` is still set.
- [ ] The artifact URL appears as **visible text** under Reproducibility, not as
      a dangling footnote marker.
- [ ] PDF properties show **no author name** (File → Properties in any reader).
      The `\pdfinfo` block handles this, but it costs ten seconds to verify.
- [ ] Page size is **US Letter**, not A4.
- [ ] You are submitting the **full paper**, not the 300-word abstract option.

## After acceptance, not before

Publication requires a **paid registration** by **30 November 2026**. An accepted
paper that is not registered does not appear in IEEE Xplore. Confirm the fee
before submitting so it is not a surprise in November.

Camera-ready then needs `\anonfalse` and `authors.local.tex` restored, which is
gitignored and lives only on the local machine.
