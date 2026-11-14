# Health Connect nights (prompt 4.2)

`fortnight-nights.json` is what the phone sends after folding the Health
Connect fixture `android/app/src/test/resources/health-connect/fortnight.json`
(made-up records; see its README): one night per wake date, the longest
session kept, resting heart rate where that date had one, and the session
still being recorded left out. `HealthNightsTest` checks the phone produces
exactly this, so the server's tests (`tests/api/sleepImport.test.ts`) and the
web's (`lib/nativeHealth.test.ts`) run on the phone's real output.
