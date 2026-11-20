# Play Console declarations: SomniAI's answers

Prompt 7.5. These are the answers for the Play Console's **Policy and programs > App content** page, checked against the release build's merged manifest (`scripts/release.mjs` checks the bundle; `tests/play-release.test.ts` fails if the manifest gains a permission this page doesn't cover).

Google's forms change. Where this page quotes a form, it quotes Google's help pages as read on 2026-11-16, not the form itself; answer what the form asks on the day, with these as the facts.

Sources:
- [Understanding foreground service and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821)
- [Permissions and APIs that access sensitive information](https://support.google.com/googleplay/android-developer/answer/9888170)
- [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Publish your health app (Health Connect)](https://developer.android.com/health-and-fitness/health-connect/publish)

## What the release asks for

From `android/app/build/intermediates/merged_manifests/release/.../AndroidManifest.xml` after `node scripts/release.mjs build`:

| Permission | Why | Play declaration |
| --- | --- | --- |
| `USE_EXACT_ALARM` | Alarms ring at the minute set (Android 13+) | **Exact alarm**, below |
| `SCHEDULE_EXACT_ALARM` (Android 12 / 12L only, `maxSdkVersion="32"`) | The same on Android 12, where the user grants "Alarms & reminders" | Covered by the exact alarm answer |
| `USE_FULL_SCREEN_INTENT` | The alarm screen over the lock screen | **Full-screen intent**, below |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` | The service that rings (`RingService`, type `systemExempted`) | **Foreground service**, below |
| `android.permission.health.READ_SLEEP`, `android.permission.health.READ_RESTING_HEART_RATE` | Last nights' sleep and resting heart rate from Health Connect, read-only, if the user connects it | **Health apps**, below |
| `PACKAGE_USAGE_STATS` | Minutes of phone use before bed, if the user turns on Usage access | No form found; **Usage access**, below |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `VIBRATE`, `INTERNET`, `ACCESS_NETWORK_STATE` | Notifications, alarms back after a restart, ringing, the server | None |
| `com.google.android.c2dm.permission.RECEIVE`, `app.somniai.alarm.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Added by Firebase Cloud Messaging (wake-buddy alerts) and AndroidX | None |

There is no `AD_ID` permission: the app uses no advertising ID.

## Exact alarm (`USE_EXACT_ALARM`)

Google allows `USE_EXACT_ALARM` only when the app's core function is an alarm or timer (or a calendar that shows event notifications), and asks for a declaration of that core function.

- **Core functionality:** Alarm clock.
- **Justification, if the form asks for one:**

  > SomniAI is an alarm clock. Its core function is waking the user at the time they set: every alarm is scheduled with AlarmManager.setAlarmClock() so it rings at that minute, including with the app closed and the phone locked. Without exact alarms the app cannot do what it is for.

## Full-screen intent (`USE_FULL_SCREEN_INTENT`)

Since 22 January 2025, for apps targeting Android 14+, only apps whose core function is setting alarms or handling calls keep this permission by default. The declaration says whether the app is one.

- **Does your app's core functionality need full-screen intents?** Yes: **Alarm**.
- **Justification:**

  > SomniAI is an alarm clock. When an alarm goes off, its ringing screen (the wake check that stops the alarm) opens over the lock screen through a full-screen intent on the alarm's notification, as Android's alarm clock does. It is used only while an alarm is ringing.

## Foreground service (`systemExempted`)

For apps targeting Android 14+, Google asks for every foreground service type the app uses, a description of each feature, its user impact, and **a link to a video** showing the user starting the feature. Google's list of types on that page doesn't name `systemExempted`; it calls the list non-exhaustive and names no exemption, so declare it.

- **Type:** `systemExempted`. Android permits it only for apps holding `USE_EXACT_ALARM` or `SCHEDULE_EXACT_ALARM`; it is the type for an alarm that continues ringing in the background.
- **Feature:** Ringing a due alarm.
- **Description:**

  > When an alarm the user set is due, SomniAI starts a foreground service that plays the alarm on the alarm stream, vibrates, holds a wake lock and shows the alarm screen over the lock screen. It runs only while the alarm is ringing and stops as soon as the user passes the wake check (three sums) or snoozes. It starts from the exact alarm the user scheduled, never on its own.

- **Impact if deferred or interrupted:** The alarm would not ring, or would stop ringing before the user is awake: the user oversleeps. It must start immediately when the alarm is due and can't be deferred.
- **Video:** the recording made by `node scripts/play-screenshots.mjs` (setting an alarm, locking the phone, the alarm ringing over the lock screen, the wake check stopping it). Upload it to YouTube as **Unlisted** (or anywhere Google can open without signing in) and paste the link. Unlisted keeps it out of search; it is still not for public posting while the paper is under review.

## Health apps (Health Connect)

Health Connect access is declared in the **Health apps** declaration on the App content page; Google reviews the explanation given for each data type. Not confirmed from Google's pages: whether testers on the internal track can connect Health Connect before the declaration is approved. If they can't, everything else works and the Data sources panel says Health Connect isn't available.

- **Health features:** Sleep management.
- **Health Connect data types, read only:**

| Data type | Permission | Explanation |
| --- | --- | --- |
| Sleep | `READ_SLEEP` | SomniAI reads the last 14 days of sleep sessions (start, end, stages) to log how long you slept, which its sleep estimates and bedtime plan use. It only reads; it never writes to Health Connect. |
| Resting heart rate | `READ_RESTING_HEART_RATE` | SomniAI reads resting heart rate for the same nights, one of the inputs to its sleep estimate. Read-only. |

- **Privacy policy:** `https://somniai.vercel.app/privacy` (it covers Health Connect data).
- **The in-app explanation** Health Connect requires is `HealthRationaleActivity` ("SomniAI and your sleep data"), linked from Health Connect's permission screen.

## Usage access (`PACKAGE_USAGE_STATS`)

No Play Console declaration for it was found on Google's sensitive-permissions page (checked 2026-11-16); if the App content page asks, answer as below. Google's User Data policy still requires a prominent disclosure before access: the app explains what it reads and why (`SCREEN_WHY` in `lib/nativeScreen.ts`) before it opens Settings' Usage access page, and the user turns it on there.

> With your permission, SomniAI counts minutes of phone use in the 3 hours before bed, once a night, and keeps them beside your sleep log; its built-in sleep estimate takes them into account. Only the minutes per night leave the phone; which apps you used never does. You can turn it off in Settings at any time.

## The rest of App content

| Section | Answer | Why |
| --- | --- | --- |
| Privacy policy | `https://somniai.vercel.app/privacy` | Public page, filled in for production (7.4) |
| App access | **All or some functionality is restricted**: give a reviewer account | Everything is behind sign-in. Make an account on production for Google's reviewers (any email, a strong password), and give it in the form only. Never in this repository |
| Ads | **No** | No ad SDK, no `AD_ID` |
| Content rating | Category **Utility, productivity, communication or other**; **No** to violence, fear, sexuality, gambling, drugs, language, crude humour. User interaction: **No** free messaging; a paired buddy sees your name and alarm label, and your phone number only if you choose. Digital purchases **No**; shares location **No** | Expected rating: Everyone / PEGI 3 |
| Target audience and content | **16–17** and **18 and over** | The terms and the sign-up page say "You must be 16 or older" (`legal/TERMS.md`); nothing for children, so not in the Families programme. Choosing only 18+ would contradict the terms |
| News app | No | |
| Government app | No | |
| Financial features | None | |
| Health apps | As above | |
| Data safety | `legal/PLAY_DATA_SAFETY.md` | Answers per data type |
| Account deletion URL | `https://somniai.vercel.app/delete-account` | Public page |
| Advertising ID | **No** | |

## When this page needs updating

- A new permission in `AndroidManifest.xml`: the test fails until it has a row here.
- Google sign-in or Google Calendar switched on in production: Data safety's account methods and Calendar rows (`legal/PLAY_DATA_SAFETY.md`).
- Text messages to an emergency contact on a full Twilio account: the store listing may mention them then (`play/listing/en-US/full_description.txt`), not before.
