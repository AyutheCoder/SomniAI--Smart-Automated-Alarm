# Hostile review of `paper/draft.md`

Read as a reviewer looking for reasons to reject, not reasons to accept. Ordered
by how much damage each objection does.

Status after the pass: **5 fixed in the paper, 4 answered, 2 accepted as real
and unresolvable without a deployment study.** R9 was open when this document
was written and was closed when §2 was drafted.

---

## R1. "Calibrated to what?" — the strongest objection

**The attack.** §4.2's headline is that the stated reliability is well
calibrated, ECE 0.0148. §5 then concedes the target has no association with
self-reported sleep quality, readiness or tiredness. So the paper's central
positive result is *calibration against a label it admits measures nothing
anyone cares about*. A perfectly calibrated predictor of an irrelevant quantity
is still irrelevant. The two sections undercut each other and the paper never
notices.

**Severity: fatal if unanswered.** This is the first thing a competent reviewer
writes, and the paper currently has no reply.

**Status: FIXED.** §4.2 now states plainly what calibration does and does not
buy here. It is a claim about internal consistency — when the system says 85%,
85% of those nights match the stated criterion — and that is exactly what a
refusal mechanism needs, because refusal is a statement about the model's own
confidence. It is not a claim that the criterion is worth caring about. The
paper now says so in the same section rather than leaving the contradiction for
the reader to find.

## R2. The refusal baselines cannot refuse

**The attack.** §4.4 compares over-promise rate against always-promise and a
90-minute cycle rule. Neither has any mechanism for declining. Measuring
"over-promise rate" against planners that structurally cannot refuse is
measuring whether they have a refusal mechanism, and the answer was known before
the experiment. It is a strawman comparison dressed as a result.

**Severity: high.** It makes the strongest-looking table in the paper
uninformative.

**Status: FIXED.** The §4.4 table now includes `forward_only` — a planner using
the *same model* and differing only in that it does not search. That is the
informative comparison, and it is also the unflattering one (see R3).

## R3. You omitted the comparison that goes against you

**The attack.** Forward-only prediction scores *better* than the inverse planner
on over-promise rate at every target. The supporting documents say so; the
paper's table did not include it. That is selective reporting, and a reviewer
who opens the repository will find it.

**Severity: high, and a credibility problem rather than a technical one.**

**Status: FIXED.** The row is in the table, and the text states the result
rather than burying it: forward-only wins on this metric, and the reason is that
the two planners make different kinds of promise. Forward-only claims tonight
already clears the bar, which the observed night tests directly. Inversion
claims a *changed* bedtime would clear it, which no participant did on our
instruction. The comparison is between a claim the data can check and one it
cannot — so it is reported, and explicitly not counted in our favour.

## R4. "Latest feasible" is asserted, not justified

**The attack.** §3.1 claims the latest qualifying bedtime is correct because it
imposes the least behavioural cost. No evidence supports this. A user facing
something important might prefer margin over minimal disruption, and a system
that always recommends the last possible moment could be actively harmful when
the model is wrong — which, at R² 0.186, it often is.

**Severity: moderate.** It is a design assumption presented as self-evident.

**Status: FIXED.** Now framed as a design choice with its trade-off stated, and
the interaction with model error named: at the latest feasible bedtime the plan
has no margin, so model error translates directly into missed wakes. The
parameter is exposed so a deployment can choose a margin, and the choice is
flagged as one a user study should settle.

## R5. PMData did not replicate

**The attack.** §4.1 calls PMData a replication cohort and reports R² −0.090 —
worse than predicting the mean. That is a failed replication. Describing it as
"the gap is smaller but present" for AUC while the duration model fails outright
is generous framing of a negative result.

**Severity: moderate.**

**Status: FIXED.** The text now says the duration model **fails to replicate** on
PMData rather than implying two supporting cohorts. The regularity model does
replicate (AUC 0.675, marginally above LifeSnaps), and the paper now
distinguishes the two rather than averaging the impression.

## R6. Renaming the target looks like moving the goalposts

**The attack.** The authors set out to predict wake success, could not validate
it, and renamed it to wake-time regularity. That is redefining the outcome after
seeing the data.

**Status: ANSWERED.** The rename followed a pre-specified validity check that
the label failed, and the paper reports the failed check with its effect sizes
rather than quietly adopting new terminology. The measured quantity never
changed — only the name, which was corrected to match what it measures. A
reviewer may still dislike it; the alternative was keeping a name the evidence
contradicts.

## R7. Low ICC undermines the premise

**The attack.** Wake regularity has ICC 0.060 — 94% of its variance is
night-to-night. §4.1 spins this as favourable ("something night-level to
influence"). Inverted: the target is mostly noise, and an AUC of 0.660 against
mostly-noise is not obviously meaningful.

**Status: ANSWERED.** Low ICC means little *between-person* structure, not that
the variance is noise; the fixed effects in §4.1 (bedtime, resting HR, both with
intervals excluding the null) are night-level and real. The paper's framing is
defensible but the sentence has been tightened to avoid sounding like
salesmanship.

## R8. The simulation scenarios are author-designed

**The attack.** Soundness holds across seven ground-truth models the authors
wrote. The authors also chose which adversarial cases to include. That is not a
proof and the test set is not independent.

**Status: ANSWERED** — already in §5, and stated before a reviewer reaches it.
Worth noting the scenarios were built to *defeat* the method (non-monotone,
redundant, interacting), not to flatter it.

## R9. Novelty against the counterfactual-explanation literature

**The attack.** Model inversion with counterfactual attribution is Wachter et
al. and DiCE. What is new beyond the application domain?

**Status: FIXED.** §2.1 now argues the delta against Wachter et al. [1], Ustun et
al. [2] and DiCE [3] explicitly, and §2.2–2.3 position the work against smart
alarms and the forward sleep-prediction literature. The argument as written: those methods
explain a *decision already made* by finding minimal changes that flip it. This
inverts against a *required probability*, partitions the search space by what is
actionable within the planning horizon, and treats infeasibility as a
first-class output rather than a failure to return an explanation. That must be
argued in related work, with citations, or the contribution reads as an
application paper.

## R10. Weak models, full stop

**The attack.** R² 0.186 and AUC 0.660. Why should anyone build on this?

**Status: ACCEPTED.** The paper's answer is that weak models are the motivation —
a planner on a signal this thin should decline to promise — and that the
alternative deployed everywhere is a system with the same weakness and no
refusal. A reviewer wanting strong prediction will not be satisfied, and the
paper says so.

## R11. No deployment study

**Status: ACCEPTED and unresolvable here.** Stated in §5 as the central
limitation. It is the honest boundary of what retrospective data can support.

---

## What changed as a result

| # | Objection | Action |
| --- | --- | --- |
| R1 | Calibrated to what? | §4.2 rewritten |
| R2 | Strawman baselines | `forward_only` added to §4.4 |
| R3 | Omitted unflattering comparison | Reported in §4.4 text |
| R4 | "Latest" unjustified | §3.1 reframed with its trade-off |
| R5 | PMData framed generously | §4.1 says "fails to replicate" |
| R6–R8 | Goalposts, ICC, scenarios | Already answered; wording tightened |
| R9 | Novelty | §2.1 written, delta argued with citations |
| R10–R11 | Weak models, no deployment | Accepted, stated in §5 |
