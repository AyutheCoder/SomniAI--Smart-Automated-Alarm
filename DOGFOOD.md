# Dogfooding SomniAI: 30 nights

Prompt 8.1. SomniAI is used as the only alarm for 30 nights. Every miss, every false alarm and every annoyance is written down here, and every real failure becomes a test and a fix.

The plan asked for two testers. One is taking part (decided 2026-11-16), **tester A**. The B steps below stay for anyone who joins later. Testers are named only by letter, because this file is public; their addresses are in `.env.deploy.local` (`DOGFOOD_ACCOUNTS`), which git ignores.

| | |
| --- | --- |
| Night 1 | *(the first night both testers are set up; fill in)* |
| Night 30 | *(Night 1 + 29)* |
| Build | Firebase App Distribution, the latest; note any update in the log |
| Status | Not started |

## What counts

| | Means | Examples |
| --- | --- | --- |
| **Miss** | An alarm didn't do its job | Didn't ring; rang more than 1 minute late; rang silently; rang with no screen to stop it; couldn't be stopped; stopped without the wake check it should have had |
| **False alarm** | Something went off that shouldn't have | Rang when turned off or deleted; rang at the wrong time; rang twice; a buddy alert while you were already up |
| **Annoyance** | Anything that made you want another alarm app | Confusing words, a slow screen, a sum too hard at 6 am, a notification you didn't want |

**Mornings that can't be missed** (a flight, an exam): keep a second alarm on another device, as SomniAI's own plan suggests. Write it in the log. It doesn't spoil the test: a miss by SomniAI is still a miss.

## Before Night 1, each tester

1. **Install the latest SomniAI from Firebase.** Tester B first needs adding: put B's Google address in `FIREBASE_TESTERS` in `.env.deploy.local`, then `node scripts/release.mjs build --apk` and `node scripts/release.mjs distribute`.
2. **Sign in.** Notifications are allowed when there's no red "Notifications are off" box on the alarms page.
3. **Run Tonight's alarm check** (the line under Adaptive Alarms). Fix everything it lists until it says all clear. On 2026-11-16 tester A's phone had 2 problems, battery optimisation among them.
4. **On Xiaomi, Redmi or POCO:** Settings → Apps → SomniAI.
   * Notifications → **Floating notifications** on.
   * **Autostart** on.
   * Battery saver → **No restrictions**.
   * **App lock** off for SomniAI.
5. **Turn off every alarm in other alarm apps**, including the phone's own Clock.
6. **Only with a second tester:** pair as wake buddies (A with B) in the Wake buddy panel. This works only once production's every-minute buddy check is scheduled (cron-job.org, `DEPLOY.md`). Until then buddy alerts don't go out: write that in the log rather than wonder why.
7. **Optional: turn on Alarm telemetry.** It records how long each alarm took to get a first touch, which makes misses and slow wakes measurable.

## Every morning, 2 minutes

1. **Tester A** runs `npm run dogfood` on the laptop and pastes what it prints under **Nights**.
   * It reads production's records.
   * It lists every alarm due that night, when it fired and how it ended.
   * It flags every miss it can see, including an alarm that was due with **nothing on record**.

   For an earlier night: `npm run dogfood -- --night 2026-11-20`.
2. **Each tester** adds what the records can't see: a false alarm, an annoyance, a sum that was too hard, anything odd. Two lines are enough.
3. **Anything real goes under Failures** with the next number (D-001, D-002, ...).

## Turning a failure into a test and a fix

1. **Gather the evidence.** Use the night's report. For a phone problem, also use `adb logcat -s SomniAlarm` from that phone (the app logs every ring step), and `npm run errors` with production's database.
2. **Write the test that fails** for the same reason: a JVM test for the phone, Vitest for the server and page, or an e2e flow.
3. **Fix it** until the test passes and `npm run verify:all` is green.
4. **Commit with the failure's number** in the message (`D-003: ...`). Ship it: `release.mjs build --apk` + `distribute` for the phone, `npm run deploy -- app production` for the server and pages.
5. **Record the commit and the build** under the failure, and mark it **Fixed**. Mark it **Verified** after a night where it didn't happen again.

## Weekly review

| Week | Nights | Alarms | Misses | False alarms | Annoyances | Fixed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1-7 | | | | | |
| 2 | 8-14 | | | | | |
| 3 | 15-21 | | | | | |
| 4 | 22-30 | | | | | |

At the end: **nights where every alarm of both testers rang on time and was stopped properly**, out of 30. That figure is the honest headline, with every failure behind it.

## Nights

*(Paste each morning's `npm run dogfood` output here, newest at the bottom, and add the testers' own notes under it.)*

## Failures

Use this form for each:

```
### D-00N: one line saying what went wrong
Night N, tester X, phone and Android version, build.
What happened: ...
Evidence: the night's report line, logcat lines, error ids.
Cause: ...
Test: path/to/test (fails before the fix)
Fix: commit, build or deploy
Status: Open / Fixed / Verified (night N)
```

### D-001: a ring cut short left no trace on the server
Found before Night 1 (2026-11-16), tester A, POCO (Android 16, HyperOS), build 0.1.0 (121).

**What happened.** The first `npm run dogfood` flagged the 18:35 alarm of 2026-11-16 as `NO RING ON RECORD`. It had rung: the phone's log shows it fired 54 ms late and climbed all five levels. It was stopped from the laptop with `am force-stop` (that ring had no way to answer it, the bug fixed in 7.5).

**Cause.** The phone reported a ring only when it ended: fire, then how it ended, in one batch (`RingService.queueSync`). A ring cut short has no end, so nothing was sent. A force-stop kills the app outright, and so can a phone maker's battery manager. That is the commonest way an alarm fails on these phones, and exactly the failure the log most needs to see. The phone's own log said "interrupted" only when Android stopped the service cleanly, and never told the server.

**Fix.** The fire is queued the moment the ring starts (`SyncCalls.fire`, in `RingService.record`), and the ring's ending follows when it ends (`SyncCalls.afterFire`). Queued, not sent: the alarm never waits on the network. A ring cut short now reaches the server as "rang", and the night report says "rang but how it ended never reached the server" instead of nothing.

**Test.** `SyncCallsTest`: the fire alone equals the first call of a whole ring; the ending never sends the fire again, for every outcome. `RingServiceTest` (on the emulators in CI): the fire is in the queue while the alarm still rings.

**Status:** Fixed in `357287a`, Firebase build `0.1.0 (125)`. Verified once a ring cut short shows up as rung.

### Found before Night 1 (prompt 7.5, the first install from Firebase), both fixed

* **Notifications off on a fresh install**, and nothing asked for them, so an alarm rang with no notification and no screen.
  * Fixed: the app asks when it opens, and shows a red warning while notifications are off (`lib/nativeNotifications.ts`, deployed `f4bcfc6`).
* **The phone in use: no screen to answer.** Android showed only a banner, hidden on HyperOS.
  * Fixed: the ring service opens the ring screen itself (`RingScreen.java`, build 0.1.0 (121)).

`DEVICE_TESTS.md` 7.5 has both, with the phone's results.

## Annoyances already known

* **Predictions offline at first.** Production's AI Brain is on Render's free plan and sleeps after 15 idle minutes. The first time the app opens after that, predictions and the night plan are briefly offline while it wakes; the app says so and uses its built-in rules. Production recorded this as 21 HTTP 502s from the AI Brain on 2026-11-16 (`npm run errors` against production). Not a bug, the cost of the free plan. Alarms never depend on it.
