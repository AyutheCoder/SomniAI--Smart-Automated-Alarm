# Screen time before bed, as the phone sends it (prompt 4.3)

`week-nights.json` is `ScreenNights.toJson` for the usage events in
`android/app/src/test/resources/screen-time/week.json` (see its README for the
nights, worked out by hand). `ScreenNightsTest` checks the phone produces
exactly this; `tests/api/screenTime.test.ts` and `lib/nativeScreen.test.ts`
use it as the phone's output. Made up: no one's real phone use.
