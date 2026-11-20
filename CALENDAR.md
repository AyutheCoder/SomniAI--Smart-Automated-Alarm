# Google Calendar (prompt 4.1)

SomniAI reads the next seven days of the user's primary Google Calendar,
read-only, and turns each event into a task scored by the semantic engine,
like a task typed in. The scheduler then treats them like any other task.

## How it works

- **Connecting** is incremental authorisation on the same Google OAuth client
  as "Sign in with Google". Sign-in asks only for who you are; calendar access
  is asked for when you press **Connect Google Calendar** in Data sources,
  with `include_granted_scopes=true`, so it adds to what was already granted.
  It works for email-and-password accounts too: the calendar is linked to the
  SomniAI account that's signed in, whichever Google account is chosen on
  Google's screen.
- **Scope:** `calendar.events.readonly`, the narrowest that reads events, plus
  `openid email` to show which Google account is connected. SomniAI can't
  change or delete anything in the calendar.
- **What's stored:** each event's title, description (as plain text) and start
  date and time, as a task. Not attendees, locations or other calendars. The
  refresh token is sealed with AES-256-GCM under a key derived from
  `NEXTAUTH_SECRET` (`lib/secretBox.ts`); access tokens aren't stored.
- **Syncing:** on connecting, on **Sync now**, and when the page opens if the
  last read is over 15 minutes old. A moved or renamed event updates its task
  (and it's scored again if the words changed); a cancelled event's task is
  removed unless it's already done. Declined invitations, working location,
  out of office and birthdays aren't tasks. An empty calendar is simply no
  tasks.
- **Token refresh:** each sync asks Google for a fresh access token with the
  stored refresh token. If Google says the grant is gone (`invalid_grant`: you
  removed SomniAI at myaccount.google.com/permissions, or it expired), or the
  Calendar API refuses the token or the permission, the connection is marked
  **revoked**: the panel says so and offers **Connect again**, and Google isn't
  asked again until then. An outage only records the error and tries next time.
- **Connecting again** after access was removed: Google's screen shows the
  calendar box unticked; tick it (or "Select all"). Without it SomniAI keeps
  nothing and says calendar access wasn't ticked. Each attempt's state is
  single-use, so start again with the button rather than the browser's back.
- **Disconnecting** asks Google to revoke the grant, deletes it here, and
  removes the calendar's tasks that aren't done.
- **In the Android app:** Google doesn't allow its consent screen inside an
  app's web view, so the app says to connect from SomniAI in a web browser.
  The connection belongs to the account, so the app has it too.

Code: `lib/googleCalendar.ts` (Google's endpoints, network passed in),
`lib/calendarServer.ts` (connection, sync, disconnect), `app/api/calendar/*`,
`models/CalendarConnection.ts`, the Calendar row in
`app/_components/DataSourcesPanel.tsx`.

## Tests

No test reaches Google or anyone's calendar. `tests/fixtures/google-calendar/`
holds token and Calendar API responses in the shapes Google documents, with
made-up events and placeholder tokens (see its README), and `fakeGoogle.ts`
answers from them and records every request. `lib/googleCalendar.test.ts`
covers the OAuth parameters, refresh, revoked grants and event mapping;
`tests/api/calendar.test.ts` the whole flow through the routes: connecting,
refusal, an unticked calendar box, a forged state, another user's consent,
syncing changes and cancellations, an empty calendar, revoked access,
a refused token, a missing permission, an outage, and disconnecting.

## Google Cloud Console setup

Use the Google Cloud project behind the Firebase project from 3.2 (Firebase
projects are Cloud projects), or any other. In
[console.cloud.google.com](https://console.cloud.google.com), with that
project selected:

1. **APIs & Services > Library:** find **Google Calendar API** and press
   **Enable**.
2. **Google Auth Platform** (called "OAuth consent screen" in older consoles):
   - **Branding:** app name `SomniAI`, your support email, your developer
     contact email.
   - **Audience:** User type **External**, publishing status **Testing**.
     Under **Test users**, add each Google account that will connect (yours).
     In Testing, only these can connect.
   - **Data Access:** **Add or remove scopes**, and add `openid`,
     `.../auth/userinfo.email` and `.../auth/calendar.events.readonly`. The
     last is a *sensitive* scope: fine for test users, but Google must verify
     the app before anyone else can use it.
3. **Clients > Create client:** type **Web application**.
   - **Authorised JavaScript origins:** `http://localhost:3000`
   - **Authorised redirect URIs**, both of these:
     - `http://localhost:3000/api/auth/callback/google` (Sign in with Google)
     - `http://localhost:3000/api/calendar/callback` (the calendar)
   - For a deployed site, add the same with its `https://` address, and set
     `NEXTAUTH_URL` there to that address.
4. Copy the **Client ID** and **Client secret** into `.env.local` (never the
   repository):
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   NEXT_PUBLIC_GOOGLE_ENABLED=true
   ```
   `NEXTAUTH_URL` must be exactly the origin you open SomniAI at
   (`http://localhost:3000`), since the redirect URI is built from it.
5. Restart the server. Data sources now shows **Connect Google Calendar**.

**Testing mode and refresh tokens:** Google expires refresh tokens after 7
days for an External app in Testing. SomniAI then shows the calendar as
revoked with **Connect again**; that is the revoked-access path working, not a
fault. Publishing the app (with verification) removes the 7-day limit.
