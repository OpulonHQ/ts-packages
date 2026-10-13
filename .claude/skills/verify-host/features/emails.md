# Emails: log, templates, outbox

Emails are written to an outbox row inside the transaction, sent after commit, and listed in the Email log with their outcome; a failed send is retried by the `*/5` sweep with backoff (5 then 10 minutes, at most 3 attempts). Admins customise each template's subject and body per language.

## Sub-features

- `after-commit` an action that emails (invite, reset) yields a log row `Sent` after 1 attempt.
- `sweep` a queued row is sent by the scheduled handler.
- `log` Email log: table `Email log`, columns Queued, Template, Recipients, Subject, Status, Attempts; statuses Queued, Sent, Failed, Skipped.
- `templates` `users.invitation` and `users.password_reset`; Save -> `The template was saved.`, badge `Customized`.

## How to get to it (user POV)

- Sidebar `Email log` -> `/admin/emails/log`.
- Sidebar `Email templates` -> `/admin/emails/templates` -> a template -> `/admin/emails/templates/<key>`.

## Driving it with ui.sh

Preconditions: a Super admin session (smoke owner).

- **Template -> invite -> log.** `$V/ui.sh .claude/skills/verify-host/journeys/emails.mjs email=<owner> 'password=smoke password <run>'`. Proves: `PUT /api/emails/templates/users.invitation/locales/en` 200 + `The template was saved.`; an invite; the Email log row for the invitee with the customised subject and `Sent`.
- **After commit + sweep.** `$V/smoke.sh` steps `an invitation email is delivered after commit` and `the cron tick sweeps a queued email` (sweep within ~15 s).
- **API view.** `GET /api/emails/log?page=&perPage=&status=` -> `{ rows: [{ templateKey, recipients, subject, status, attempts, ... }], total }`.

## Gotchas

- Locally nothing fires the cron unless something calls `/__scheduled`; `smoke.sh` does, a plain launch doesn't.
- `Mailer.log` logs recipient and subject only; there are no bodies or links anywhere to read.
- The emails journey leaves `users.invitation` customised for later runs; cleanup's database drop resets it.
