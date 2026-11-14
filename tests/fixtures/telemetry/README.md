# A wake as the phone sends it (prompt 5.1)

`snoozed-wake.json` is what `WakeTelemetry.java` produces for one morning
(`WakeTelemetryTest` checks it exactly): an alarm at 07:00 in India (01:30Z)
snoozed at 07:00:15 after a touch 12 s in, rung again at 07:05:15 and opened
from the notification 3 s in, snoozed again, and rung at 07:10:20, touched 61 s
in, and stopped at 07:11:50 after three sums (four tries, 21 s on task) at the
challenge stage. `tests/api/telemetry.test.ts` and `lib/telemetryClient.test.ts`
use it as the phone's output. Made up: no one's real morning.
