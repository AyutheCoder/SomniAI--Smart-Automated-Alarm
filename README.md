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
  then every backup channel — on a timeline that depends on the chosen strategy.
- **Verifies wakefulness.** Math, typing, shake or QR challenges, scored into a
  confidence figure that must clear a per-alarm threshold.
- **Plans backwards.** Give it a wake time and a required reliability and it
  solves for the latest bedtime that gets you there.
- **Learns.** A reinforcement-learning policy adapts wake strategy to what has
  actually worked for you.

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
| `npm run e2e` | End-to-end flows in headless Chromium (Playwright), about 3 minutes |

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
   nothing was dismissed.

Each flow really waits for the alarm, so a run takes about three minutes.
Before the flows, `e2e/warmup.ts` signs in a throwaway user and requests every
API route once, because `next dev` compiles a route on first use and a cold
compile can outlast the alarm's own requests. Retries are off: a flow that
only passes on a second try is a failure. Run `npx playwright install chromium` once after `npm install`. Like
`verify`, it shares `.next` with `npm run dev`, so stop that first.

## Limitations

The alarm only fires while a browser tab is open — there is no background
scheduler or push delivery yet, so it is not yet a replacement for a phone alarm.
Shake and QR challenges need a device with an accelerometer and camera.
