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
| `npm run lint` | ESLint |

## Limitations

The alarm only fires while a browser tab is open — there is no background
scheduler or push delivery yet, so it is not yet a replacement for a phone alarm.
Shake and QR challenges need a device with an accelerometer and camera.
