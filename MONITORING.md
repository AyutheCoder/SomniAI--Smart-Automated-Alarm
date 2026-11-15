# Monitoring and failure modes

Prompt 7.3. What SomniAI records when something breaks, how you learn the AI
Brain is down, and what users see while the AI Brain, the database or the
network is unavailable.

## Error tracking

Errors go to SomniAI's own database, collection `errorevents`
(`models/ErrorEvent.ts`). They come from three places:

| From | How |
| --- | --- |
| Server | A route error that isn't a validation error, a duplicate or a database outage (`lib/http.ts` `routeError`). The caller still gets "Something went wrong on our end". |
| Pages | Errors nothing caught (`lib/errorReporter.ts`, installed in `Providers`), the error pages (`app/error.tsx`, `app/global-error.tsx`), and each home-page panel's boundary (`PanelBoundary`). Each is sent to `POST /api/errors` (signed in only). A page sends each distinct error once and at most 10 per load. |
| AI Brain | Its catch-all handler answers 500 with the error's type and message (`ai-brain/errors.py`) and logs one JSON line on stderr. The app records each 500 it receives (`lib/aiClient.ts`). |

Reports never include personal details:
* Before storing, `lib/errorTracking.ts` replaces email addresses, ids, tokens, phone numbers and URL queries.
* The AI Brain uses the same rules. Both are tested against one fixture, `tests/fixtures/error-scrub/cases.json`.
* No account is recorded.

Storage and retention:
* Errors are grouped by type, message shape, place and top stack frame; a repeat raises the count.
* Reports are deleted 90 days after the error last happened.
* If the database can't take a report, it goes to the server log as one line, `{"event":"error-not-recorded",…}`.

Read them:

```
npm run errors                         # the last 7 days
npm run errors -- --days 30 --stack    # further back, with stacks
npm run errors -- --source ai-brain    # server, browser or ai-brain
```

## AI Brain uptime

The scheduler that sends buddy alerts also calls `POST /api/cron/ai-brain-health`
every minute, with the same `Authorization: Bearer <CRON_SECRET>`. Locally,
`npm run buddy:cron` runs both checks. In production, schedule both
`/api/cron/buddy-alerts` and `/api/cron/ai-brain-health` every minute.

Each check asks the AI Brain's `/health` (`lib/uptime.ts`):
* **Down** means 2 failed checks in a row. A failed check is no answer within the timeout, a non-2xx answer, or running without its models. The outage is dated from the first failed check.
* **Up** means one good answer.
* Each outage is stored in `outages` with its reason, and the current state in `servicestatuses`.
* One alert is sent when an outage starts and one when it ends, to `OPS_ALERT_WEBHOOK`:
  * Discord or Slack incoming webhook, or an ntfy topic URL;
  * a self-hosted ntfy also needs `OPS_ALERT_FORMAT=text`.
* Each alert is recorded as delivered, failed or not_configured. It counts as delivered only on a 2xx answer.

While the AI Brain is down, the home page says, for example: "Predictions and
the wake planner are offline since 07:12. Alarms ring as normal, and SomniAI
uses its own rules until they're back." If the checks haven't run for 5
minutes, the status is "unknown" and the page says nothing.

An in-app check can't notice the whole server being down. For that, point an
external monitor (UptimeRobot, Better Stack) at the app's sign-in page.

## Failure modes, and the tests that hold them

**The AI Brain is down** (`tests/api/failure-ai-brain.test.ts`). The suite plays the AI Brain with a real socket and runs four modes: connection refused, never answers, drops mid-answer, answers 500. In each mode:
* every route whose imports reach `lib/aiClient.ts` answers clearly within 5 s;
* the AI routes use the app's own rules;
* the wake planner says "The wake planner is offline right now…" with a 503;
* an alarm is still set with a full ring plan, rings and is stopped.

The AI Brain's 500s are recorded, scrubbed.

**The database is down** (`tests/api/failure-database.test.ts`):
* Every handler of every API route answers within 5 s, never with a 500. Most say "The database is unavailable. Please try again shortly." with a 503.
* Signing in says the database isn't answering, not "Invalid email or password".
* Sessions stay valid (`tests/api/session.test.ts`).
* The ring itself never needed the database. `tests/api/ring-db-down.test.ts` covers the page; the phone never asks the server at ring time.

**The network is lost mid-request:**
* The ring results that the phone and page send through their outboxes carry an `Idempotency-Key`. A resend after a lost answer is answered from the first time, not recorded twice (`lib/idempotency.ts`, `tests/api/idempotency.test.ts`).
* On the phone: `OutboxSyncTest.aCallWhoseAnswerIsLostIsSentAgainWithTheSameKey`, with a server that hangs up after reading the call.
* In a browser: `e2e/failure-network.spec.ts`. Every result's first answer is dropped after the server did the work. The alarm still rings and stops, the page says its updates are waiting, and each event is recorded once.
* A panel that receives an answer it can't use shows that it failed and reports it. The rest of the page, alarms included, keeps working.
