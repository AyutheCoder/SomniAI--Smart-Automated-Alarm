# Deploying SomniAI

Prompt 7.4. The web app runs on Vercel, the AI Brain on Render (built from
`ai-brain/Dockerfile`), and the data in MongoDB Atlas. There are two copies:
**staging**, where changes are checked first, and **production**, which real
people and the Android app use.

| | Staging | Production |
| --- | --- | --- |
| Web app (Vercel, Mumbai) | project `somniai-staging` | project `somniai` |
| AI Brain (Render, Singapore) | `somniai-brain-staging`, free plan (sleeps when idle) | `somniai-brain`, free plan (sleeps when idle) |
| Database (Atlas M0, AWS Mumbai) | `somniai-staging`, its own user | `somniai-production`, its own user |
| Addresses | `deploy/environments.json` | `deploy/environments.json` |

Both AI Brains are on Render's free plan (the operator's choice, 2026-11-16). After 15
minutes without a request one goes to sleep, and the next request takes about a minute
to wake it; meanwhile the app uses its own rules and says predictions are offline
(alarms never depend on it). The two share the workspace's 750 free hours a month, so
near the end of a month one can be stopped until the next. Moving production to an
always-on plan is one line in `scripts/deploy.mjs` (`renderPlan: "starter"`) and a card
on the Render account.

Each database user can read and write only its own database: a staging key can't
touch production data (checked when they were set up).

## No Git integration, on purpose

The repository is public and the paper is under double-blind review. Vercel's
and Render's GitHub apps post deployment links on commits, and those can name
whoever runs the accounts. So neither is connected to GitHub:
* Vercel deploys from this machine with its CLI (`.vercelignore` decides what is uploaded, and never uploads `.env*.local`).
* Render builds the public repository at a given commit, on request.

Nothing deploys on push.

## Keys and settings

Everything secret lives in `.env.deploy.local`, which git ignores and nothing prints:

| Name | What |
| --- | --- |
| `VERCEL_TOKEN`, `RENDER_API_KEY` | The two hosts' API tokens (team ABCD on Vercel, workspace somniai on Render) |
| `ATLAS_STAGING_URI`, `ATLAS_PRODUCTION_URI` | The two connection strings |
| `SOMNIAI_OPERATOR`, `SOMNIAI_CONTACT`, `SOMNIAI_JURISDICTION` | Who runs SomniAI, for production's privacy policy and terms |
| `OPS_ALERT_WEBHOOK` (optional) | Where outage alerts go (MONITORING.md) |
| `STAGING_*`, `PRODUCTION_*` | Made by `scripts/deploy.mjs` on first setup: `NEXTAUTH_SECRET`, `CRON_SECRET`, `AI_BRAIN_TOKEN`, and staging's `TEST_KEY` |

`scripts/deploy.mjs` gives each Vercel project:
* its database string and its own secrets;
* the AI Brain's address and key;
* the Google, Firebase and Twilio keys from `.env.local`;
* `SOMNIAI_ENV`;
* in production only, the operator's details and the hosting and backup lines for the privacy policy.

Google sign-in stays off (`NEXT_PUBLIC_GOOGLE_ENABLED=false`) until the redirect addresses below are registered.

The AI Brain gets only `AI_BRAIN_TOKEN`. With it set, everything except `/health`
needs `Authorization: Bearer <token>` (`ai-brain/access.py`), so its public
address answers only the app.

`npm run verify`'s secret check reads `.env.deploy.local` too: none of these values
may appear in a tracked file, the git history or the browser bundle.

## Deploying

```
git push                                   # Render builds from GitHub, so the commit must be there
npm run deploy -- all staging              # setup, AI Brain, web app, health check
npm run e2e:staging                        # the end-to-end flows against staging
npm run deploy -- all production           # the same commit, once staging passed
```

The steps one at a time:
* `setup <env>` creates or updates both services and their settings.
* `brain <env>` deploys the AI Brain at `HEAD` (pushed) and waits until it's live.
* `app <env>` deploys this working tree to Vercel.
* `check <env>` asks both for their health.

Healthy means:
* the AI Brain's `/health` answers with its models loaded;
* the app's public `/api/health` reports the database up, the AI Brain up, and the right environment.

`/api/health` also reports which commit is deployed.

The end-to-end flows run from this machine against staging (`E2E_BASE_URL`). They send
staging's test key, which lifts the sign-up limit for them on staging only
(`SOMNIAI_ENV=staging`; production has no key, and the check refuses
anywhere else). The developer simulator's flow is skipped: it exists only under
`next dev`.

## Scheduled checks (cron-job.org)

Vercel's free plan runs cron jobs once a day, and the buddy alerts and the AI Brain
uptime check need every minute. cron-job.org calls both, for each environment:

| URL | Every | Header |
| --- | --- | --- |
| `<app>/api/cron/buddy-alerts` | 1 minute | `Authorization: Bearer <that environment's CRON_SECRET>` |
| `<app>/api/cron/ai-brain-health` | 1 minute | same |

## Google sign-in and Calendar

In Google Cloud Console, open **APIs & Services → Credentials** and the OAuth client. Under **Authorized redirect URIs**, add, for each environment:
* `<app>/api/auth/callback/google`
* `<app>/api/calendar/callback`

Then set `<ENV>_GOOGLE_ENABLED=true` in `.env.deploy.local` and run `npm run deploy -- setup <env>` and `app <env>`.

## The Android app

A release build points at production: `npm run android:prod` builds with
`CAP_SERVER_URL` set to production's address and `CAP_RELEASE=1`, which refuses
anything but HTTPS. Debug builds (`npm run android:build`) still use the dev server on this
machine. Signing a release for Google Play is prompt 7.5.
