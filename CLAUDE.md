# CLAUDE.md — SomniAI

Loaded automatically by Claude Code at the start of every session. It carries the
context a new machine does not have. Keep it current: update **Progress** after
every finished prompt.

## What this is

SomniAI is an alarm app: a Next.js 15 / React 19 / TypeScript web app on MongoDB
with NextAuth, plus a Python FastAPI service ("AI Brain", `ai-brain/`) using
scikit-learn. It reads tasks, schedules its own alarms, plans the night backwards
from a must-wake time with an explicit "this is not reachable" verdict, escalates
in stages, and verifies the user is awake before dismissing.

A methods paper on the planning algorithm is written and under review. The
current job is **developing the app**, following `DEVELOPMENT_PLAN.md`.

## The job

Execute `DEVELOPMENT_PLAN.md` **one prompt at a time, in order**. The human pastes
each prompt. Each prompt ends with its verification gate (plan, Part 4). Red is
not done: fix the cause before moving on, and never weaken a test to make it pass
unless the test is genuinely wrong, in which case say so explicitly.

Read `DEVELOPMENT_PLAN.md` Part 1 before the first prompt. Its central finding:
**alarms currently ring only while a browser tab is open**, because firing is a
`setInterval` in `app/page.tsx` and sound is Web Audio in that page. Phase 2
fixes it natively on Android.

## Progress

| | |
| --- | --- |
| **Next prompt** | **0.4** |
| Last completed | 0.3 (274 API tests on in-memory Mongo, route bugs fixed and listed in its commit; `verify:all` green: 358 vitest, 283 pytest) |
| Branch for development | `develop` |

Update this table after each prompt, in the same commit.

## Baseline at handoff (2026-10-22)

70 TS tests pass, `tsc` clean, lint 0 errors / 11 warnings, 283 Python tests pass
(28 skip without the LifeSnaps download, 4 slow deselected), **`next build`
failed** on the original machine (prompt 0.1 checks and fixes it here), 22 API
routes with **no tests** (0.3).

## Hard rules

1. **No author identity in any tracked file.** The paper is under double-blind
   review and this repository is public. No names, e-mails, institution or GitHub
   usernames in code, docs, comments or commit-tracked files. Run
   `node scripts/check-anonymity.mjs` before every push; it needs the private,
   gitignored `.anonymity-terms.local`. If that file is missing, ask for it and do
   not push until the check runs clean. This rule has been broken by accident
   once already.
2. **Leave the co-author's fork alone.** The paper's anonymised artifact mirror
   (anonymous.4open.science) is built from the `research/evaluation-pipeline`
   branch of the *co-author's fork* of this repository, pinned to commit
   `fe1df9d`. Never push to, delete or force-push that branch, and keep both this
   repository and that fork **public** until the paper decision; breaking either
   breaks the link reviewers use. Development happens in this repository on
   `develop`, branched from `main`.
3. **Don't touch the research pipeline or the paper**: `paper/`,
   `ai-brain/datasets/`, `ai-brain/evaluation/`, `ai-brain/training/train_real.py`,
   `BUILD_PLAN.md`, `REPRODUCE.md`, `docs/`. Only prompt 5.2 changes training, and
   it must leave `python ai-brain/reproduce.py` passing unchanged.
4. **Nothing reports success it didn't achieve.** No fake "triggered", no
   simulated value presented or used as real.
5. **The alarm never waits on the network** at ring time.
6. **A feature without a test is not done.** Device-only behaviour is checked on
   a real phone and recorded in `DEVELOPMENT_PLAN`'s `DEVICE_TESTS.md`.
7. **Commit convention set by the project owners:** commits are authored by the
   human working on the project, with **no AI co-author trailer**.
8. Never print or commit secrets. `.env.local` stays local.

## Commands

| | |
| --- | --- |
| Web dev server | `npm run dev` |
| TS tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| AI Brain tests | `cd ai-brain && python -m pytest -p no:warnings` |
| AI Brain server | `cd ai-brain && uvicorn main:app --reload` |
| Anonymity guard | `node scripts/check-anonymity.mjs` |
| Full gate | `npm run verify` / `npm run verify:all` (`scripts/verify.mjs`; red on any failure, warning, or empty run) |

## Where things are

| Path | What |
| --- | --- |
| `DEVELOPMENT_PLAN.md` | **The plan being executed.** 37 prompts, 8 phases |
| `app/` | Next.js pages, components, 23 API routes under `app/api/` (the plan says 22) |
| `tests/api/` | Route integration tests, in-memory MongoDB, session stubbed in `setup.ts` |
| `lib/` | Core logic: `scheduler.ts`, `escalation.ts`, `wakeConfidence.ts` (gated scoring), `backupAdapters.ts` (currently fake), `context/` (calendar/wearable simulated), `sensors/` (silent simulated fallbacks) |
| `models/` | Mongoose models |
| `ai-brain/` | FastAPI service: `wake_plan.py` (the paper's method), `semantic.py`, `predict.py` |
| `INVENTION_DISCLOSURE.md` | Patent notes. Public disclosure already happened 2026-08-05 |
| `PRODUCT_PLAN.md` | Superseded by `DEVELOPMENT_PLAN.md`; kept for history |

## Environment gotchas, learned the hard way

- **Windows: clone to a short path such as `C:\somniai`.** numpy's nested test
  fixtures exceed the 260-character `MAX_PATH`, and the failure surfaces as a
  misleading `No module named 'numpy._utils'`.
- **Windows Git Bash mangles backslashes** in heredocs and `python -c` strings.
  `\r` in `\ref` has become a literal carriage-return byte more than once. For
  any edit containing backslashes (LaTeX, regexes), use the file-editing tool or
  write a script to a file, never an inline shell string. Then verify the bytes.
- A stray `package-lock.json` in a parent directory makes Next.js pick the wrong
  workspace root. Fix with `outputFileTracingRoot`, not by deleting files outside
  the repo.
- `next build` hit `EPERM: kill` on the original Windows machine. It did not
  reproduce on the second machine (Node 22, no parent lockfile), so it was not
  diagnosed further; if it returns, suspect an antivirus or file lock on `.next/`.
- LifeSnaps (Zenodo record 7229547) returned HTTP 504 for days in October 2026.
  PMData downloads fine. `python ai-brain/fetch_datasets.py --out data/external`
  resumes. Datasets are only needed for prompt 5.2.
- Lint is `eslint .` (flat config in `eslint.config.mjs`), not the deprecated
  `next lint`. It covers the whole repo, not only `app/` and `lib/`, and ignores
  `ai-brain/` because its virtualenv contains vendored JavaScript.

## Platform limits to state honestly

iOS cannot be built on Windows; it needs Xcode on a Mac, and the route there is
AlarmKit (iOS 26+). Android-first. Manufacturer battery managers (Xiaomi, Realme,
Oppo, Vivo) can still stop a correct alarm; prompts 2.7 and 3.1 mitigate, nothing
fully removes it.
