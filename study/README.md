# Study mode (prompt 6.2)

The app's support for running the study in `PREREGISTRATION.md`. **Nothing here is
to be used with participants until an ethics committee has approved the study
(DEVELOPMENT_PLAN 8.2).**

## For the researchers

1. **Codes.** `node scripts/study-codes.mjs 60` makes 60 single-use enrolment codes
   (`--uses N` for more uses each, `--days N` to expire them). They are printed once:
   only their SHA-256 hashes are stored.
2. **A participant joins** in the app: Home > Research study, enters the code, reads
   the consent document (`lib/studyConsent.ts`, version `study-v1`) and agrees. They
   get a random participant code (`P-…`). Joining starts the per-alarm randomisation
   of the wake plan (prompt 6.1) from the study's seed, and alarm telemetry (5.1).
3. **Leaving**, at any time, from the same place, deletes everything collected for
   the study: the assignments, the study arms in alarm plans, the telemetry recorded
   since joining, and the enrolment, which is the only link between the account and
   the participant code. Telemetry is turned off. The participant's own alarms and
   sleep log stay.
4. **Export.** Set `STUDY_EXPORT_TOKEN` on the server, then
   `GET /api/study/export` with `Authorization: Bearer <token>`. Without the token
   set, the export is off (503).

## What the export holds

Per participant: their code, the consent version, and

- `assignments`: alarm number (within the participant), study day, sequence, block,
  arm, whether excluded as unmissable or later overridden;
- `nights`: study day, weekend, sleep hours, local bedtime and wake time, and the
  method paper's wake-time regularity label;
- `wakes` (telemetry): alarm number and arm, study day, local time of the first ring,
  outcome, snoozes, time to first interaction, stage reached, the wake check's result.

Never names, e-mail addresses, account or alarm ids, alarm labels, or dates: days
count from each participant's enrolment day. `tests/api/study.test.ts` checks this
against users with real-looking names, emails and alarm labels.
