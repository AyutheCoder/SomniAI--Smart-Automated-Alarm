# Health Connect fixtures (prompt 4.2)

Sleep sessions and resting heart rate as `HealthConnect.java` reads them from
Health Connect's `SleepSessionRecord` and `RestingHeartRateRecord` (start, end,
stages with Health Connect's stage numbers, the writing app; time and beats per
minute). Made up: no one's real health data. The zone is Asia/Kolkata
(+05:30) and "now" is 2026-11-16 09:00 there.

Stage numbers: 1 awake, 2 sleeping, 3 out of bed, 4 light, 5 deep, 6 REM,
7 awake in bed (0 unknown).

| File | What it stands for |
| --- | --- |
| `fortnight.json` | Three nights: one with stages; a split night with a nap (three sessions on one date); a night two apps recorded, one only in part; a session still being recorded; resting heart rate on two of the dates, three readings on one |
| `empty.json` | Health Connect allowed, but nothing recorded |
