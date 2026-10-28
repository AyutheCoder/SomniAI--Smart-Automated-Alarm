# Wake buddy (prompt 3.2)

Two SomniAI users pair up. If one of them doesn't confirm they're awake a set
number of minutes after a **critical** alarm, the other gets a push on their
phone: "Sam hasn't confirmed they're awake", with a button that opens the
dialler on Sam's number (if Sam chose to share it).

## How it works

- **Pairing needs both people.** One taps "Get a code" (valid a day, once) and
  gives it to the other, who enters it and asks to pair: their consent. The
  first then accepts: theirs. Only then is the pairing active, both ways: each
  is the other's buddy. One buddy at a time. Either can **unpair** at any time,
  and alerts stop at once. A new code replaces the old; a code can be withdrawn.
- **When an alert goes out** (`lib/buddy.ts`, `alertVerdict`): the alarm is on,
  it is critical (or the sleeper opted in to ordinary alarms too), its time plus
  the sleeper's delay (15 minutes by default, 5 to 60) has come, and the server
  hasn't heard that they verified or stopped it. A snoozed ring counts from when
  it was first due. A ring more than two hours past its alert time is skipped:
  the check was down, and an alert then helps nobody.
- **Rate limit** (`rateVerdict`): one alert per ring (a push-service failure is
  retried, three tries in all), none within 30 minutes of the last, at most
  three in 24 hours, per pair and direction.
- **The check** (`lib/buddyAlerts.ts`) runs every minute, called by a scheduler
  at `/api/cron/buddy-alerts` with `Authorization: Bearer <CRON_SECRET>`.
  Without `CRON_SECRET` the route refuses everything. Each try is recorded, sent
  or not, and the sleeper sees the recent ones in the panel.
- **The push** (`lib/push.ts`) is a Firebase Cloud Messaging data message, so
  the phone builds the notification itself, call button included
  (`BuddyMessagingService.java`). The button opens the dialler with the number
  filled in; the buddy presses call. No call permission.

## What is shared, and what isn't

- A buddy sees the other's **name** (never their e-mail address), and, in an
  alert, that alarm's **label** and how long ago it rang. Nothing about other
  alarms, tasks or sleep.
- A **phone number** goes into alerts only if its owner entered it and turned
  on "Put my number in my alerts". Removing the number turns sharing off.

## Limits, stated honestly

- **The server only knows what reaches it.** If the sleeper's phone is offline
  when they wake, their verification waits in the phone's queue (2.4), and the
  buddy may be told even though they're up. That's why the alert says "hasn't
  confirmed they're awake", not "hasn't woken".
- **Push needs Firebase**, set up once (below). Until then, alerts are recorded
  as "push isn't set up on the server" and nothing pretends to have been sent.
- **The scheduler** has to exist wherever the server runs: locally it's
  `npm run buddy:cron`; in production, Vercel Cron or any scheduler calling the
  route every minute (prompt 7.4 deploys it).

## Setup

### What you do in Firebase (about 10 minutes)

1. **Create a project.** Go to <https://console.firebase.google.com>, "Create a
   project". Give it a **neutral name** such as `somniai-dev`, not your own name:
   the project ID appears in the app's configuration and the server's settings.
   Google Analytics isn't needed; turn it off. The free (Spark) plan is enough.
2. **Add the Android app.** In the project, "Add app" > Android. Package name:
   **`app.somniai.alarm`** (exactly). Nickname and SHA-1 can stay empty.
   "Register app", then **download `google-services.json`** and save it as
   **`android/app/google-services.json`** in this folder. It is gitignored;
   never commit it. Skip the remaining "Add Firebase SDK" steps: they're done.
3. **Make the server's key.** Project settings (gear icon) > **Service accounts**
   > "Generate new private key". It downloads a `.json` file: **a secret**. Don't
   paste it into a chat or commit it. Run:
   ```
   node scripts/firebase-env.mjs <path to the downloaded file>
   ```
   which copies it into `.env.local` without printing it. Then move the file
   somewhere safe outside this folder, or delete it.
4. **Check the messaging API is on.** Project settings > **Cloud Messaging**:
   "Firebase Cloud Messaging API (V1)" should say Enabled (it is, for new
   projects). If it says Disabled, follow its link and enable it.

### What I (or anyone with the repo) do after that

5. Add `CRON_SECRET` to `.env.local` (`.env.local.example` shows how to make
   one).
6. Start the server for phones, `npm run dev:phone` (a local MongoDB, no
   install), and on each phone or emulator `adb reverse tcp:3000 tcp:3000`.
7. Build the app with Firebase in it and that server,
   `CAP_SERVER_URL=http://localhost:3000 npm run android:build`, and install it
   on both (`adb -s <device> install -r` the APK).
8. Run `npm run buddy:cron` alongside. Each minute it prints what the check did.
9. The two-device test in `DEVICE_TESTS.md`, 3.2. A second phone, or the
   emulator with a Google Play image, can be the buddy. A critical alarm is one
   made with "Critical: must not miss" ticked, or from a task marked critical.

## Tests

| Where | What |
| --- | --- |
| `lib/buddy.test.ts` | Codes, phone numbers, trigger timing (each delay, awake, ordinary alarms, off, stale), the rate limit (per ring, retries, 30-minute gap, 3 a day) and the alert's wording |
| `lib/push.test.ts` | Not configured sends nothing; the service-account JWT verifies; the FCM request; token caching; a gone token; failures |
| `tests/api/buddy.test.ts` | Pairing with consent on both sides, declining and withdrawing, one buddy at a time, unpairing from either side, settings, push tokens, and the alert end to end against the database: timing, awake, ordinary alarms, snooze, both directions, unpaired, the shared number, the rate limit, retries, gone tokens, no phone, push not configured, and the scheduler route's secret |
| `lib/nativeBuddy.test.ts` | The phone's token sent to the server, or why not |
| `e2e/buddy.spec.ts` | Two browsers: code, ask, accept, both see each other, unpair |
| JVM, `BuddyAlertMessageTest` | The push read on the phone; only a number ever reaches the dialler |
| Two phones | `DEVICE_TESTS.md`, 3.2 |
