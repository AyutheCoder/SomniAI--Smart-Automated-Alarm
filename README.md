# SomniAI

Semantic-Aware Adaptive Circadian Intelligence System — an alarm that reads your
task list, decides how hard to wake you, and verifies you are actually awake
before it will switch off.

## What it does

- **Reads tasks in plain English.** "final exam tomorrow" is classified as
  critical / must-not-miss / stress, and the due date is parsed out of the wording.
- **Schedules its own alarms.** Task importance and predicted oversleep risk set
  the wake time, intensity, strategy and verification requirements.
- **Escalates in five stages.** Volume, then vibration, then a wake challenge,
  then the backup channels, on a timeline that depends on the chosen strategy.
  Each backup (second device, smartwatch, emergency contact) reports what
  really happened: sent, failed, or not set up.
- **Verifies wakefulness.** Math, typing, shake or QR challenges, scored into a
  confidence figure that must clear a per-alarm threshold.
- **Plans backwards, every evening.** The home page opens on *Tonight*: give it
  a must-wake time and how much it matters, and it answers with the latest
  bedtime that reaches it, or the smallest set of changes that does. If nothing
  tonight can, it says so plainly: the most it can reach, the habit holding you
  back, and a nudge to set a second alarm, with a button that adds one.
  "Remind me at 22:15" sends a web notification at bedtime while a SomniAI tab
  is open (native in a later phase). Regularity is the chance of waking close
  to your usual time; it says nothing about how the morning went.
- **Learns.** A reinforcement-learning policy adapts wake strategy to how you
  have responded to past alarms (snoozes, challenge results).
- **Says where every prediction comes from.** Each one is labelled as coming
  from the AI Brain or the fallback rules, with a confidence in plain words.

## Architecture

| Part | Stack | Port |
| --- | --- | --- |
| Web app + API | Next.js 15, React 19, TypeScript, Tailwind | 3000 |
| AI Brain | FastAPI, scikit-learn | 8000 |
| Database | MongoDB | 27017 |

The app degrades gracefully: if the AI Brain is unreachable, every prediction
falls back to deterministic rules and the UI reports `fallback` instead of
`AI Brain`.

## Running it locally

Prerequisites: Node 20+, Python 3.11+, and a MongoDB instance.

```bash
# 1. Configuration
cp .env.local.example .env.local        # then fill in the values

# 2. Database (Docker is the quickest route)
docker run -d --name somniai-mongo -p 27017:27017 mongo:7

# 3. AI Brain
cd ai-brain
pip install -r requirements.txt
python main.py                          # trains models on first boot

# 4. Web app (from the project root, in a second terminal)
npm install
npm run seed                            # optional: demo account + 14 nights of data
npm run dev
```

Open <http://localhost:3000>. The seed script creates `demo@somniai.app` with the
password `demo1234`.

> **Note:** trained model artifacts (`ai-brain/models/*.joblib`) are not committed.
> They are regenerated automatically from `ai-brain/data/enhanced_sleep_dataset.csv`
> the first time the AI Brain starts.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (stop `dev` first — they share `.next`) |
| `npm run seed` | Reset the demo account to a known state |
| `npm run lint` | ESLint over the whole repository; any warning fails |
| `npm test` | Unit tests (vitest) |
| `npm run verify` | The full web gate: lint (zero warnings), `tsc --noEmit`, vitest, `next build` |
| `npm run verify:all` | `verify` plus the AI Brain pytest suite |
| `npm run e2e` | End-to-end flows in headless Chromium (Playwright), about 5 minutes locally |

### Checking a change

Run `npm run verify:all` before calling any change done. It runs every step
even after one fails, so a single run shows everything that is wrong, then
prints a summary and exits non-zero if anything failed:

```text
PASS  lint     111 files, 0 errors, 0 warnings (10.8s)
PASS  tsc      0 errors (19.8s)
PASS  vitest   15 files, 358 passed, 0 failed, 0 skipped, 358 total (16.2s)
PASS  build    production build (103.3s)
PASS  pytest   283 passed, 0 failed, 0 errors, 28 skipped, 311 total (110.1s)

VERIFY PASSED
```

A step also fails if it exits cleanly but its report cannot be read or it ran
zero tests, so an empty run never shows as green.

The vitest step has two projects. `unit` covers `lib/` and `scripts/`. `api`
(`tests/api/`) calls every route handler against a throwaway in-memory
MongoDB from `mongodb-memory-server`, never the database in `.env.local`, and
with no AI Brain, so routes run on their local fallbacks. For each route it
checks that a signed-out request is rejected, that bad input gets a clear
error, the normal case, and that one user can never read, change or delete
another's alarms, tasks, sleep logs or events. `tests/api/coverage.test.ts`
fails if a route handler has no test. The first run downloads a MongoDB binary
(about 100 MB, cached afterwards); run one project with
`npx vitest run --project api`. The pytest step uses
`ai-brain/.venv` when it exists, otherwise `python` on your `PATH`. The 28
skipped tests need the LifeSnaps download and four slow simulation studies are
deselected by default (see `ai-brain/pytest.ini`). Stop `npm run dev` first:
the build shares its `.next` directory.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `develop`
and `main`, as three parallel jobs: `npm run verify`, the AI Brain pytest
suite (Python 3.13, the version `requirements-lock.txt` was made on), and
`npm run e2e`. npm, pip, the Playwright browser and the MongoDB test binary
are cached. It needs no secrets: every test brings its own database and the
build reads no environment. Traces of failed end-to-end flows are kept as a
run artifact for a week.

### End-to-end flows

`npm run e2e` starts its own `next dev` on port 3100 against a throwaway
in-memory MongoDB, with no AI Brain and no Google sign-in. The variables it
sets take precedence over `.env.local`, so the flows never touch your real
database. In headless Chromium it then:

1. signs up a new user, sets an alarm one minute ahead, waits for it to ring,
   solves the maths challenge, and checks the alarm history shows it verified;
2. does the same but answers wrong, and checks the alarm keeps ringing and
   nothing was dismissed;
3. takes the database down at ring time, and checks the alarm still rings and
   is dismissed with no API call during the ring, then syncs when it is back;
4. plans an evening the planner refuses, and adds the recommended backup alarm;
5. plans a feasible evening, sets the bedtime reminder and the alarm, and
   moves the clock to bedtime to see the reminder fire;
6. sets an alarm while the page's first load is still out, and checks the
   late, older answer doesn't wipe it.

Each flow really waits for the alarm, so a run takes about five minutes locally,
where the flows run one at a time to spare memory, and about two on CI.
Before the flows, `e2e/warmup.ts` signs in a throwaway user, loads the pages
the flows visit and requests every API route once, because `next dev`
compiles a page or route on first use and a cold
compile can outlast the alarm's own requests. Retries are off: a flow that
only passes on a second try is a failure. Run `npx playwright install chromium` once after `npm install`. Like
`verify`, it shares `.next` with `npm run dev`, so stop that first.

## Limitations

The alarm only fires while a browser tab is open — there is no background
scheduler or push delivery yet, so it is not yet a replacement for a phone alarm.

Within that limit, ringing needs no server. Each alarm stores its whole ring
plan (sound, escalation ladder, challenge, criticality) when it is set, along
with whether the AI Brain or the rule-based fallback decided it and why. The
ringing screen plays only from that record, so a server, database or AI Brain
outage at ring time changes nothing: the alarm rings, its challenge runs and a
snooze or dismissal takes effect on the device. The outcome is sent to the
server afterwards and retried until it gets through, and the alarm list is
kept on the device so a reload during an outage still has it.
None of the backup channels can be set up yet, so every one of them reports
"not set up"; the app never claims a backup reached anyone.

Calendar and wearable data aren't connected yet. Predictions use only live
data: the sleep logs and alarm history you record, and live weather once you
allow location. The home page's **Data sources** panel shows which sources are
connected. Everything carries its source (`live`, `simulated` or `missing`);
anything simulated, such as the developer simulator's data, is treated as
missing by every model. In development only, `SOMNIAI_SIMULATED_INPUTS=allow`
lets simulated data through so the simulator can demonstrate predictions;
production ignores it. Shake and QR
challenges need a device with an accelerometer and camera.
