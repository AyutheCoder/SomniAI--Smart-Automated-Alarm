# Google Play Data safety form: SomniAI's answers

Prepared in prompt 7.2 for the Play Console's *App content > Data safety* form, against the code as of that prompt. The form describes the **Android app**: what it sends off the phone (Google's "collect"), and what reaches a third party (Google's "share"). Re-check it whenever a prompt adds a data source, an SDK or a permission, and keep it in step with `legal/PRIVACY.md`.

Definitions used (Play Console Help, "Provide information for Google Play's Data safety section"):

- **Collected**: sent off the device, by the app or a library in it.
- **Shared**: sent to a third party. Not sharing: a **service provider** processing it for the developer on the developer's instructions; a transfer the user starts and expects (e.g. pairing with a buddy); the law.
- **Optional**: users can use the app without it or can turn it off. Otherwise required.
- **Processed ephemerally**: kept only in memory, only for the request.

## Data collection and security (section 1)

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | The account, alarms, and the optional sources below. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Release builds load the server over HTTPS only (`capacitor.config.ts`, tested in `tests/capacitor-config.test.ts`); Google, Firebase and Twilio are HTTPS. **Only true if the deployed server is HTTPS**: check before submitting. |
| Which account creation methods does your app support? | **Username and password**, and **OAuth (Sign in with Google)** | `lib/auth.ts`. |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In the app: *Your data* > *Delete my account* (`app/_components/AccountPanel.tsx`). |
| Delete account URL | `https://<your domain>/delete-account` | Public page (`app/delete-account/page.tsx`): sign in and delete, or write in if you can't sign in. |
| Data deletion: can users request that some data is deleted without deleting the account? | **Yes** | Telemetry (delete all), Google Calendar (disconnect), the study (leave), buddy pairing (end), emergency contact (remove). |

## Data types (section 2)

(Updated in prompt 7.3: Crash logs are now collected.)

For every type below: **not shared** (the services involved are service providers: hosting, Google, Firebase, Twilio), **not processed ephemerally** unless said, and the purposes listed. Nothing is used for advertising, marketing, analytics SDKs, or fraud scoring.

### Personal info

| Type | Collected | Required? | Purposes | What, where in the code |
| --- | --- | --- | --- | --- |
| Name | Yes | Optional | App functionality, Account management | The account's name (`models/User.ts`), shown to a wake buddy; the emergency contact's name. |
| Email address | Yes | Required | Account management, App functionality | Sign-in; the Google Calendar account's address (`models/CalendarConnection.ts`). |
| User IDs | Yes | Required | Account management, App functionality | The account id the server gives every record. |
| Phone number | Yes | Optional | App functionality | Your phone, shared with your buddy only if you choose; the emergency contact's number, texted through Twilio (`lib/sms.ts`). |
| Address, race and ethnicity, political or religious beliefs, sexual orientation, other info | No | | | |

### Health and fitness

| Type | Collected | Required? | Purposes | What |
| --- | --- | --- | --- | --- |
| Health info | Yes | Optional | App functionality, Personalization | From Health Connect, read-only: sleep sessions and resting heart rate, last 14 days (`HealthConnect.java`, `lib/sleepImport.ts`); the sleep log you type. |
| Fitness info | No | | | No exercise, steps or activity is read. (Google's examples for Fitness info are "exercise or other physical activity"; sleep and resting heart rate are declared as Health info, the more cautious choice.) |

Health Connect also needs the Play Console's **Health apps declaration** (*App content > Health apps*): declare **Sleep management** as the use, read access to `READ_SLEEP` and `READ_RESTING_HEART_RATE`, the privacy policy URL, and the explanation shown by `HealthRationaleActivity`.

### Messages, Photos and videos, Audio files, Files and docs, Financial info

Not collected. The alerts and texts SomniAI sends are its own notifications, not your messages. The app asks for no microphone, camera, photo or file permission (`AndroidManifest.xml`); its wake check is a sum on the ring screen, and only the result is sent.

### Calendar

| Type | Collected | Required? | Purposes | What |
| --- | --- | --- | --- | --- |
| Calendar events | Yes | Optional | App functionality | Google Calendar, read-only scope, next 7 days, turned into tasks (title, time, description); `lib/googleCalendar.ts`, `lib/calendarServer.ts`. The OAuth consent itself also needs Google's verification of the sensitive scope. |

### Contacts

| Type | Collected | Required? | Purposes | What |
| --- | --- | --- | --- | --- |
| Contacts | Yes | Optional | App functionality | The emergency contact (a name and number you type, not read from the phone's contacts) and buddy pairings (who is paired with whom). Declared because Google's Contacts type includes contact names and "social graph information". |

### App activity

| Type | Collected | Required? | Purposes | What |
| --- | --- | --- | --- | --- |
| App interactions | Yes | Required | App functionality, Personalization | When alarms rang and how they were stopped, snoozed or checked (`app/api/alarms/[id]/*`, `models/BehaviorEvent.ts`): the alarm can't report its outcome otherwise, so it's required. |
| App interactions (telemetry) | Yes | Optional (consent, off by default) | App functionality, Personalization, Analytics | Time to first touch, snoozes, stage reached, the check's result (`WakeTelemetry.java`, `lib/telemetry.ts`). Analytics because, in the research study, an anonymised export is analysed. |
| Other user-generated content | Yes | Required | App functionality | Alarm labels, tasks you type. |
| Other actions | Yes | Optional | App functionality, Personalization | Minutes of phone use in the 3 hours before bed (Usage access; `ScreenNights.java`). Not which apps: app names never leave the phone, so **Installed apps is No**. Google has no type for device screen time; this is the closest, and over-declaring is the safe side. |
| Installed apps, In-app search history | No | | | |

### Web browsing, Location

Not collected by the Android app: it has no location permission (`AndroidManifest.xml`, checked in `lib/legal.test.tsx`). The web app's weather, which sends a location rounded to about 11 km and keeps none, is not part of the Android app.

### App info and performance

| Type | Collected | Why |
| --- | --- | --- |
| Crash logs | **Yes**, required, purpose **Analytics** (and App functionality), not shared | Since prompt 7.3: errors in the app's pages (which run in the app's web view) are sent to SomniAI's own server (`lib/errorReporter.ts`, `POST /api/errors`) and kept 90 days, with email addresses, ids, tokens and numbers removed and no account attached (`lib/errorTracking.ts`). No third-party crash SDK. |
| Diagnostics | No | The bedtime check runs on the phone and its results stay there; the AI Brain's uptime check is the server's own. |
| Other app performance data | No | |

### Device or other IDs

| Type | Collected | Required? | Purposes | What |
| --- | --- | --- | --- | --- |
| Device or other IDs | Yes | Optional | App functionality | The Firebase Cloud Messaging registration token, for wake-buddy alerts (`lib/push.ts`, `models/Buddy.ts` PushToken); Firebase's own installation id comes with the SDK. |

## Before submitting

1. The deployment's privacy policy must be complete: set `SOMNIAI_OPERATOR`, `SOMNIAI_CONTACT`, `SOMNIAI_HOSTING`, `SOMNIAI_BACKUPS`, `SOMNIAI_JURISDICTION` (`lib/legal.ts`). `/privacy` warns at the top while any is missing.
2. Privacy policy URL: `https://<your domain>/privacy`. It must be public (it is: `middleware.ts`) and not a PDF.
3. Check the answers against the release build (prompt 7.5) and the server it points at.
4. These are prepared answers, not legal advice; have the policy and the form reviewed before publishing.
