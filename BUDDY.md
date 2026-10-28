# Wake buddy and backups (prompts 3.2 and 3.3)

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
  (`SomniMessagingService.java`). The button opens the dialler with the number
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
| `lib/sms.test.ts` | Twilio: not configured sends nothing; basic auth and the form; sent only with a SID; Twilio's refusal in its own words; international format only |
| `tests/api/backups.test.ts` | The backup level per channel: second device delivered (with Firebase's id, never to the asking device), failed, not_configured, a gone token forgotten, the stop; smartwatch never; people "later" at the delay, delivered once texted, not_configured otherwise; the emergency contact in the server's check (after the delay, once, not when answered or ordinary, its own rate limit, retries, no text without consent); the routes and the contact settings |
| `lib/backupClient.test.ts` | The web's check of the server's answer |
| JVM, `BackupsTest`, `BackupRingTest`, `RingControllerTest` | The phone's check of the answer; the backup ring (no check, no backups of its own, stopped only for its alarm); the controller asks without waiting, records the answer during or after the ring, stops a device it rang |
| On the device, `RingServiceTest` | The backup level asks a server on the device while still ringing, records "delivered" and "later", shows who will be told, and queues the stop |
| `e2e/buddy.spec.ts` | The emergency contact needs their agreement, says when texts aren't set up, and can be removed |
| Two phones | `DEVICE_TESTS.md`, 3.2 |

## Backups (prompt 3.3)

When a ringing alarm reaches its backup level (the ladder's last step), the
ringing device asks the server, in the background, and keeps ringing whatever
the answer (`POST /api/alarms/[id]/backups`, `lib/backupServer.ts`). Every
channel reports exactly one of **delivered** (a transport accepted it and gave
its own id: Firebase's message name, Twilio's SID), **failed** (with the reason),
or **not_configured**; `dispatchBackups` turns a "delivered" without a receipt
into a failure, and the phone and the web check the answer again on arrival.

| Channel | When | How |
| --- | --- | --- |
| **Second device** | At the backup level, at once | Every other phone or tablet the user is signed in on gets a push and **rings** like an alarm (`BackupRing.java`): louder in steps, stopped with Stop, no wake check of its own and **no backup level of its own**, so two devices can't keep ringing each other. When the alarm is stopped on the first device, the others are stopped too (`/backups/stop`, through the phone's queue) |
| **Wake buddy** (3.2) | After the sleeper's delay | Push, as in 3.2. At the backup level it's reported as "later", with the time |
| **Emergency contact** | After the sleeper's delay, same rules as the buddy | A **text through Twilio**, sent by the server's check, so it goes even if the phone is dead. Only to a contact the user confirmed agreed to it |
| Smartwatch | Never | SomniAI has no watch app; a watch paired with the phone already shows the alarm's notification. Always "not set up" |

People are told only after the delay, by decision (2026-10-28): the second
device bothers nobody else, so it rings at once; a person is woken only once the
sleeper's own delay has passed, and only for critical alarms (or ordinary ones
if they opted in). The ring screen says when ("Your buddy Bo and Mum will be
told at 7:15 if you haven't answered").

### Why Twilio for the emergency contact

The options compared before building it (the user chose Twilio):

- **Twilio SMS from the server** (built): works when the phone is dead or
  offline; no Play-restricted permission. Costs per message plus a number;
  for India, Twilio's domestic route needs DLT registration (a registered
  company and sender ID), the international route doesn't but costs more and
  shows a random sender. A trial account texts verified numbers only.
- **The phone's own SMS**: `SEND_SMS` is limited by Google Play to default SMS
  apps and rare approved exceptions, so an alarm app would very likely be
  refused; without it the app can only open the SMS app, which someone asleep
  can't press Send in. Doesn't work when the phone is dead.
- **A call**: `ACTION_DIAL` needs a tap; `ACTION_CALL` (CALL_PHONE) places it,
  but takes the phone's audio away from the alarm and the contact hears silence.

### Twilio setup (for a real text)

1. Sign up at <https://www.twilio.com/try-twilio> (a free trial is enough to
   test). Verify **your contact's number** under Phone Numbers > Verified Caller
   IDs: a trial account can only text verified numbers.
2. Get a number to send from (Phone Numbers > Buy a number; the trial gives
   credit), or create a Messaging Service.
3. Put three values in `.env.local`, never in the repository:
   `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (Console home page), and
   `TWILIO_FROM` (the number, as `+1…`, or the Messaging Service SID, `MG…`).
4. Restart the server. The panel stops saying "Texts aren't set up on this
   server yet". Numbers must be in international format (`+91…`).
