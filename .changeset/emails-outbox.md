---
'@opulonjs/core': minor
'@opulonjs/emails': minor
---

Add `@opulonjs/emails`: modules declare email templates with `emailTemplate({ key, audience, placeholders, defaults })` in `contributes` (they must depend on `emails`), and send them with `EmailService.send(template, { to, locale, vars, about })`. A send writes a queued email log row in the caller's transaction and is delivered after commit; the `emails.outbox_sweep` task retries (3 attempts with backoff) and `emails.log_purge` removes rows after 90 days. Staff emails render in the recipient's admin locale, public ones in a content locale. The host configures `emails({ from, brand, layout?, adminLocales?, contentLocales? })` and provides a `Mailer` in its infra: `Mailer.resend()` (secret `EMAILS_RESEND_KEY`), `Mailer.log` or `captureMailer()` for tests. `emailsAdmin()` adds the email log screen (`emails.log.view`); pass the package's directory in `opulonAdmin({ sources })`. Core adds `defineExtensionPoint` and `contributes` on `defineModule`: composition rejects duplicate contribution keys, a missing owner, a contributor without `dependsOn` on the owner and keys outside the contributor's prefix.
