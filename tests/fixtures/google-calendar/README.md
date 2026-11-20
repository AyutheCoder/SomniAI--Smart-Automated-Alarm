# Google Calendar fixtures (prompt 4.1)

Responses in the shapes Google's OAuth token endpoint and Calendar API v3
(`events.list` on the primary calendar) return, so the tests never reach
Google or anyone's real calendar. The people, events and tokens are made up;
the email domain is `example.com` and every token is a placeholder.

Times are around 2026-11-16 in Asia/Kolkata (+05:30); the tests fix "now" to
`2026-11-16T00:00:00Z`.

| File | What it stands for |
| --- | --- |
| `token-exchange.json` | `POST /token` with an authorisation code: access and refresh token, granted scopes, id_token |
| `token-exchange-no-calendar.json` | The same, when the user unticked calendar access on Google's consent screen |
| `token-refresh.json` | `POST /token` with a refresh token: a new access token, no new refresh token |
| `token-invalid-grant.json` | `POST /token` after the user removed SomniAI's access (or the grant expired) |
| `events-page1.json`, `events-page2.json` | A week of events over two pages: timed, all-day, cancelled, declined, recurring, working location, untitled |
| `events-changed.json` | The same week later: the exam moved and renamed, the passport appointment and the flight cancelled, the gym unchanged |
| `events-empty.json` | An empty calendar |
| `events-401.json` | The access token refused |
| `events-403-scope.json` | Insufficient scopes |
