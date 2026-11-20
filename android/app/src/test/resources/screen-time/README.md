# Screen-time fixtures (prompt 4.3)

Android usage events as `ScreenUsage.java` reads them from
`UsageStatsManager.queryEvents`: time, event type, app and activity. Made up:
no one's real phone use, and the app names are placeholders. The zone is
Asia/Kolkata (+05:30), so 14:30Z is 20:00 there, and "now" is 2026-11-16 10:00.

Event types, as in `UsageEvents.Event`: 1 an app came to the foreground,
2 it left, 16 the screen went off, 11 a system record (standby bucket), which
only shows that the records go back that far. `bedtimes` is what the page
passes from the sleep log.

`week.json`, night by night (times in India):

| Wake date | Bed | Before bed | Screen time |
| --- | --- | --- | --- |
| 10th-12th | | The records start on the 12th at 14:00 | skipped: `before_records` |
| 13th | 22:40, the phone's reading | Video 20:00-21:30, the home screen for a minute (not counted), chat 22:10-22:40; next use 06:50 | 90 + 30 = **120** |
| 14th | 23:00, the phone's reading | Browser 19:00-20:30, of which 30 min after 20:00; video 21:00-22:00 and chat 21:30-22:15 side by side, 75 min together; a book from 22:30 until the screen went off at 23:00; a 4-minute check at 02:10, which doesn't move bed | 30 + 75 + 30 = **135** |
| 15th | 22:00, from the sleep log | Video 21:00-23:30: the phone alone would say 23:30 | 21:00-22:00 = **60** |
| 16th | 21:50, the phone's reading | Only a 5-minute chat at 21:45; up at 07:30; the night is settled although it's only 10:00 | **5** |

`tests/fixtures/screen-time/week-nights.json` is what the phone sends for it;
`ScreenNightsTest` checks that, and the server's and the page's tests use it.
