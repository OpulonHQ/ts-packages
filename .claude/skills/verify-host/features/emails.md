# Emails: log, templates, outbox

Every email the system decides to send is queued in the outbox after the transaction commits, sent, and listed in the Email log with its outcome; failed sends are retried by the `*/5` cron sweep. Admins edit email templates.

## Sub-features

- `after-commit` an action that emails (invite, reset) produces a log row `sent` after 1 attempt.
- `sweep` a queued row is sent by the scheduled handler.
- `log` Email log screen: Queued, Template, Recipients, Subject, Status, Attempts.
- `templates` Email templates -> a template -> Save -> `The template was saved.`

## How to get to it (user POV)

- Sidebar `Email log` -> `/admin/emails/log`.
- Sidebar `Email templates` -> `/admin/emails/templates/:key`.

## Driving it with ui.sh

Preconditions: signed-in Super admin.

- **After commit + sweep.** `$V/smoke.sh` steps `an invitation email is delivered after commit` and `the cron tick sweeps a queued email` (the helper hits `/__scheduled` every 5 s; expect a sweep within ~15 s).
- **Log screen.** Open `/admin/emails/log`; the smoke's invitation rows are listed with status sent. Second view: `GET /api/emails/log?perPage=100`.
- **Template.** Open a template, change the subject, `Save`, expect `The template was saved.`; trigger that email (e.g. an invite) and check the new subject in the log.

## Gotchas

- Locally nothing fires the cron unless something calls `/__scheduled`; a queued row stays queued otherwise.
- `Mailer.log`: bodies are printed to the wrangler log, not sent.
- Not yet driven through the UI by a journey.
