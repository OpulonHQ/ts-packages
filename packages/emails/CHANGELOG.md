# @opulonjs/emails

## 0.3.0

### Patch Changes

- @opulonjs/admin@0.3.0
  - @opulonjs/core@0.3.0
  - @opulonjs/ui@0.3.0

## 0.2.0

### Patch Changes

- 5d53e23: Lists keep every column in view and answer the same way on every screen. `DataTable` cells wrap (long words and paths anywhere) instead of Nuxt UI's one line, so a long title or path no longer pushes the columns after it out of the visible box (a collection with long post titles hid Status and Updated on a 1440 px screen); a column with `nowrap: true` stays on one line (statuses, dates, numbers). The first load shows "Loading…" instead of the empty state; a failed load shows its message with a "Try again" button and no empty state (`errorMessage` sets the message; the `error` slot still replaces both); an empty result while a search or filter is active says "Nothing matches the search or filters." with Reset; clickable rows get the pointer cursor.

  `formatDate` and `formatDateTime` (medium date, short time, the admin locale) format every list and history date: pages, items, revisions, media and the email log. The cms column reads "Updated" as media's does. Pages sort by any column like a collection's items; the users list sorts by status; email templates open on a row click like every other list and name their languages; the email log and template columns follow a language switch.

- 516ae41: The sidebar lists what you can open and keeps your place. A `NavItem` takes `children` (`NavChild`: a message key or a name per admin locale, and route params): the item becomes an expandable group whose entries open its route with their params, drawn as a tree (a line down the side, a rounded branch and a dot into each entry, darker on the current one), and a group opens itself when you are in it and otherwise stays as you left it. cms lists every collection under Collections and every menu under Menus, so their screens lose the row of tab buttons and take the collection's or menu's name as their title. A route's `nav` names the nav entry a screen without one belongs to (`cms.page` → Pages, `cms.item` → Collections, `users.user` → Users, `emails.template` → Email templates), and `useNavTarget()` names the exact entry when the route cannot (an item editor names its collection); the entry stays highlighted and the navbar shows its name on detail screens, where it was empty. Content reads Pages, Collections, Menus, Media, Redirects, Site settings in every host (`order` 10 to 60); a host's own Content item with the default `order` 0 now sorts above Pages, so give it an `order` above 60 to keep it after them. Nav items without a `group` now show next to Dashboard as documented; they were dropped whenever another group existed. The user screen gets a breadcrumb back to Users.

  `Brand` takes `wordmark` (a wide logo that includes the name, shown instead of mark and name in the open sidebar) and `wordmarkDark`, and `logoDark` for the square mark.

- 8f1f383: Every editor saves and asks the same way. `useCloseGuard({ isOpen, close, dirty })` guards a slideover that holds a small record's form: bound as `v-model:open`, `:dismissible` and `@close:prevent`, it makes Cancel, ×, Escape and an outside click ask "Discard unsaved changes?" while the form has unsaved changes and close at once while it has none, and `leave()` asks the same before another row or a new record replaces the form (one question at a time, so its answer applies to the request that asked). `useUnsavedChanges` takes `within` (the element holding a form inside a dialog: Cmd/Ctrl+S saves while that dialog is open, but not behind another dialog over it, such as a delete confirmation) and `guardWhileBusy` (leaving keeps asking while a save of several requests runs, since leaving would cut it short).

  Roles, invitations and redirects open in a slideover instead of a card above the list: the form in the body, its message at the top (success green, failure red), Cancel and the primary action ("Save", "Send the invitation"; Delete for an existing redirect, whose confirmation now says what deleting does) in the footer. Each form registers with `useUnsavedChanges({ bar: false, within })`, so leaving the screen asks and Cmd/Ctrl+S saves it from inside the slideover; a new role or invitation with nothing typed has no unsaved changes, and a role's permissions compare as a set, so unchecking and checking one again is no change. A saved role, a sent invitation or a saved or deleted redirect closes the slideover and says so above the list; Super admin still only explains that it cannot be edited; Import CSV stays in the header. The media details slideover asks the same before it closes or another item opens while alt text or a caption is unsaved, and an upload asks before it starts; that text survives Replace file, Archive and Restore, Cmd/Ctrl+S saves it, and the fields are locked while a request runs.

  The user screen's roles save from the unsaved-changes bar ("Save roles" is gone), and a language change, a deactivation, a reactivation or a refused save no longer resets unsaved role toggles; the admin language still applies at once; messages are green or red. The email template editor saves from the bar: Save stores every language whose subject or body differs from what emails use (its override, else the default), one after another, with the fields locked meanwhile and leaving asking until the last one is stored; a refused language keeps its changes, shows why and opens its tab while the others save, and Discard puts every language back. The per-language Save button is gone; Preview, Send me a test and Reset to default stay, and a language with unsaved changes notes that the test uses the saved wording. "Send this email" still applies at once and now says whether it was saved (a failure turned it back without a word); Reset to default waits in its dialog until done.

- Updated dependencies [5d53e23]
- Updated dependencies [8002758]
- Updated dependencies [516ae41]
- Updated dependencies [8f1f383]
- Updated dependencies [d3f7e8a]
  - @opulonjs/ui@0.2.0
  - @opulonjs/admin@0.2.0
  - @opulonjs/core@0.2.0

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
