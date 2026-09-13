# NSRR / MESA Sleep — data access request

Everything needed to submit today. Draft text is written to be pasted into the
form and edited, not used verbatim without reading it.

**Start here:** <https://sleepdata.org/data/requests/mesa/start> (create an
account first). Questions: <support@sleepdata.org>.

---

## Read this before you submit

**One open question I could not resolve, and it is the one that affects you
most.** The NSRR's original Data Access and Use Agreement required IRB approval
from the requester's institution. The NSRR's own published account of the
resource notes this was found to be an impediment for students and international
researchers, which implies it was relaxed — but the current requirements sit
behind the sign-in wall and I could not confirm them from public pages.

You have no institutional affiliation and no IRB. So:

1. **Email <support@sleepdata.org> today, in parallel with starting the form.**
   Ask directly: *"I am an independent researcher with no institutional
   affiliation, working with de-identified data for a methods paper. Is IRB
   documentation or an institutional signature required for a MESA Sleep data
   request?"* Their answer determines whether this route is open to you at all.
2. **Do not let this block Phase 1.** MMASH is open access and downloadable
   today. If MESA is refused on affiliation grounds, the paper is still viable —
   smaller N, a limitation you state plainly. Better to know that now than in
   three weeks.

**Also worth knowing:** every NSRR page currently carries the banner *"This
repository is under review for potential modification in compliance with
Administration directives."* That is not a normal notice. Treat continued
availability as uncertain and download promptly if access is granted.

---

## What you would be getting

MESA is an NHLBI cardiovascular cohort of 6,814 participants. The part you want
is **MESA Sleep**: between 2010 and 2012, **2,237 participants** completed

- full overnight **unattended polysomnography**
- **7-day wrist actigraphy**
- a **sleep questionnaire**

Actigraphy plus the questionnaire is what makes your wake-success proxy
derivable at all. Note that other MESA exams are distributed through BioLINCC
rather than NSRR — you do not need those.

---

## Draft request text

The form is behind sign-in, so I could not enumerate its exact fields. These
cover what data-access forms of this kind ask for; map them onto whatever the
form actually presents.

### Project title

> Reliability-targeted inverse wake planning: solving for bedtime under a
> wake-success constraint

### Lay summary

> Sleep applications generally forecast: given a person's behaviour tonight,
> they predict how long or how well that person will sleep. A user with a hard
> obligation the next morning has the opposite question, which is a constraint
> rather than a forecast — "I must be up at 05:40 and I cannot miss it; what do
> I have to do tonight?"
>
> This project develops and evaluates a method that inverts a trained sleep
> model against such a constraint. Given a required wake time and a target
> reliability, it searches the behaviours a person can still change before bed
> for the latest bedtime that meets the target, and when no admissible
> combination reaches it, reports that explicitly along with which longer-term
> habits are responsible.
>
> The method has so far been developed against simulated data. MESA Sleep would
> allow it to be trained and evaluated on real human sleep measurements, which
> is a precondition for publishing it.

### Research plan

> **Aims.** (1) Train and validate models of sleep duration and morning wake
> outcome on real actigraphy and questionnaire data, replacing the synthetic
> panel used during development. (2) Evaluate a constrained inverse-planning
> method that solves for the latest bedtime meeting a specified wake-reliability
> target, against baselines including a fixed alarm, a fixed sleep-duration
> ("90-minute cycle") calculator, and forward prediction without inversion.
>
> **Data use.** From MESA Sleep: 7-day actigraphy (per-night summaries and epoch
> data), the sleep questionnaire, polysomnography-derived summary measures
> (total sleep time, sleep onset latency, wake after sleep onset), and
> demographic covariates (age, sex, race/ethnicity) as model inputs.
>
> **Outcome definition.** MESA does not record alarm response, so the wake
> outcome will be a derived proxy — waking within a defined window of the
> participant's intended or habitual wake time, reconstructed from actigraphy
> and diary/questionnaire data. Sensitivity to the window parameter will be
> reported, and the proxy's limitations stated explicitly in any publication.
>
> **Analysis.** Models will be evaluated with participant-level grouped splits
> so that nights from one participant never span training and test. Results will
> be reported with effect sizes and confidence intervals using mixed-effects
> models appropriate to repeated nights within participants, against both
> majority-class and naive baselines.
>
> **Output.** A single methods paper submitted to a peer-reviewed venue in
> health informatics or applied machine learning. MESA will be cited and
> acknowledged as required. No commercial product will be derived from the data,
> and no data will be redistributed.

### Data security statement

> Data will be stored on a single password-protected, full-disk-encrypted
> personal computer, accessible only to me. It will not be uploaded to shared
> drives, cloud storage, public repositories, or any third-party service, and
> will not be included in the project's public code repository. No attempt will
> be made to identify any participant. Data will be deleted at the end of the
> agreement term unless an extension is granted.

### Affiliation

Answer honestly: **independent researcher, unaffiliated.** Inventing an
institution would be a false statement on an agreement you are signing, and it
is exactly the sort of thing that gets access revoked and a paper retracted. If
they refuse unaffiliated requesters, that is worth finding out cleanly.

---

## What the agreement commits you to

The full text appears in the portal when you sign — read it there, since the
below is assembled from NSRR's public documentation rather than the signed
agreement itself.

| Commitment | What it means for you |
| --- | --- |
| **No re-identification** | You may not attempt to identify any participant, or contact them. This is the term that gets access revoked. |
| **No redistribution** | You cannot pass the data to anyone else — not a collaborator, not a supervisor, not a public repo. Anyone else who needs it files their own request. **This constrains your reproducibility package:** ship code and instructions for others to request the data themselves, never the data. |
| **Secure storage** | The review committee explicitly checks that you have committed to storing it securely. Honour what you wrote above. |
| **Approved use only** | Use is limited to the research you described. A substantially different project means a new request. |
| **Citation and acknowledgement** | The MESA and NSRR papers must be cited in any publication. The dataset page lists the required references. |
| **Three-year term** | The agreement expires three years from grant, renewable by extension request or a fresh application. |
| **Committee review** | Each request is reviewed by the NSRR Review Committee for appropriateness of use. Allow **up to two weeks**. |

Data itself is free of charge.

---

## After you submit

1. **Start MMASH immediately** — it is open, it downloads today, and prompts 5–7
   of the build plan all run on it. MESA arriving later is an upgrade in sample
   size, not a prerequisite.
2. **Log the submission date** here so the two-week clock is visible:

   - Request submitted: `____________`
   - Support email sent re: affiliation: `____________`
   - Decision received: `____________`

3. **Chase at two weeks.** The stated review window is two weeks; silence past
   that warrants a polite follow-up to support@sleepdata.org.
