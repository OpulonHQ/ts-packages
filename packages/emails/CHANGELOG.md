# @opulonjs/emails

## 0.1.0

### Minor Changes

- 989b8f8: Add `@opulonjs/emails`: modules declare email templates with `emailTemplate({ key, audience, placeholders, defaults })` in `contributes` (they must depend on `emails`), and send them with `EmailService.send(template, { to, locale, vars, about })`. A send writes a queued email log row in the caller's transaction and is delivered after commit; the `emails.outbox_sweep` task retries (3 attempts with backoff) and `emails.log_purge` removes rows after 90 days. Staff emails render in the recipient's admin locale, public ones in a content locale. The host configures `emails({ from, brand, layout?, adminLocales?, contentLocales? })` and provides a `Mailer` in its infra: `Mailer.resend()` (secret `EMAILS_RESEND_KEY`), `Mailer.log` or `captureMailer()` for tests. `emailsAdmin()` adds the email log screen (`emails.log.view`); pass the package's directory in `opulonAdmin({ sources })`. Core adds `defineExtensionPoint` and `contributes` on `defineModule`: composition rejects duplicate contribution keys, a missing owner, a contributor without `dependsOn` on the owner and keys outside the contributor's prefix.
- a6b8976: Email template overrides: `emailsAdmin()` adds an email templates screen (permission `emails.templates.manage`) listing every contributed template with its audience, placeholders and per-locale override state, and an editor to override subject and body per locale, insert placeholders and email components, preview with sample values, send a test to yourself through the outbox, reset to the default and turn a template off (its sends are logged as `skipped`). Overrides are sanitized to the restricted rich text format on save and at render; edits and test sends are audited (`emails.template.*`). Email components are written as `[[name prop="value"]]` in bodies (code defaults included) and rendered at send time: the package ships `button`, `callout`, `divider` and `table`, and hosts add their own with `emails({ components: [emailComponent({ name, props, render })] })`. `@opulonjs/admin` re-exports `useRoute` and `RouterLink` for module screens; `RichTextControl` exposes `insert(content)`.
- fe35a6d: First public release: the seven packages ship together as 0.1.0, proven by the fixture host on real Workers with Hyperdrive, R2 and the cron trigger.

### Patch Changes

- 82541fe: Review fixes. users: a session is created atomically with deactivation and password reset (migration 0002), invitations are checked and written under the users/roles lock, one pending invitation per address (migration 0003), and accepting an invitation is rate limited per address and checks the token before hashing the password. cms: redirect paths are decoded and canonical (dot segments, repeated slashes) for writes, CSV import and lookup; backslashes and `//` are refused. emails: the retry cap holds when a last attempt was cut off; public emails use core's content locales (the `contentLocales` option is removed); bodies are sanitized with sanitize-html instead of xss. core: composition refuses the Authorization middleware or a Policy on a public group.
- b605844: Review fixes, round 2. cms: SSR drops credentials passed to the in-process cms fetch outside `?preview`, and HTML that read any non-public cms answer is `private, no-store` without Cache-Tag; `resolve` answers non-site paths (encoded `//`, backslashes, control characters) as not found and redirects to canonical paths in one hop, never off the site; in the default locale, redirect paths drop its own prefix and a `from` under another locale's prefix is refused, so a redirect cannot loop through resolve's prefix redirect; the sitemap index links children at `<apiPrefix>/cms/sitemaps/<file>`, and routed collections' sources are `cms.items.<key>`; Cache-Tag headers stay under 8 KiB by collapsing page and item tags into `cms:routes` (also for SSR HTML); a Cloudflare purge's deadline covers its body. users: accepting an invitation takes the users/roles lock first, so it cannot deadlock with a re-invite. emails: every delivery attempt ends at a deadline inside its lease, and Resend's timeout covers the response body.
- Updated dependencies [2cfa7cb]
- Updated dependencies [5695e71]
- Updated dependencies [5abf4a7]
- Updated dependencies [66b5358]
- Updated dependencies [75a1754]
- Updated dependencies [9b5e748]
- Updated dependencies [9775d9c]
- Updated dependencies [d469616]
- Updated dependencies [6636323]
- Updated dependencies [7a40f65]
- Updated dependencies [e134aff]
- Updated dependencies [989b8f8]
- Updated dependencies [a6b8976]
- Updated dependencies [6a1cb67]
- Updated dependencies [c2e96ad]
- Updated dependencies [82541fe]
- Updated dependencies [358c403]
- Updated dependencies [16f34ba]
- Updated dependencies [16f34ba]
- Updated dependencies [fbd8cac]
- Updated dependencies [0fd36d5]
- Updated dependencies [5f8d9d9]
- Updated dependencies [047f45d]
- Updated dependencies [cdd3b8b]
- Updated dependencies [b19c299]
- Updated dependencies [0832d55]
- Updated dependencies [4847ec7]
- Updated dependencies [5553449]
- Updated dependencies [fe35a6d]
- Updated dependencies [2130809]
  - @opulonjs/core@0.1.0
  - @opulonjs/admin@0.1.0
  - @opulonjs/ui@0.1.0
