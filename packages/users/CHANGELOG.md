# @opulonjs/users

## 0.5.0

### Minor Changes

- 6c70812: A host chooses the admin languages: `createAdmin({ locales: ['en', 'it'], defaultLocale: 'it' })`. The language menu, the language picker on the account and user screens, Nuxt UI's own texts and the kit's texts follow that list; a user whose saved language is not offered gets the default. With one language offered the language menu is hidden. Without `locales` the admin offers English and Slovak as before. `createAdmin` throws when `defaultLocale` is not one of the offered languages. Before sign-in the page is marked with the language it shows (`<html lang>`): the default language on a fresh start, the language the user had after a sign-out. It shows English for a text the auth module's catalog lacks.

  The packages ship Italian catalogs next to English and Slovak for the shell, the kit and the users, cms, emails and media modules. `@opulonjs/ui` exports `nuxtUiIt`; `useAdmin().locales` holds the offered list.

  An admin module needs only an English catalog: `defineAdminModule({ messages: { en } })`. Other languages are optional and may be partial, and a text a language lacks is shown in English. `defineAdminModule` returns the loaders it was given as present (`module.messages.sk()` still compiles for a module that has `sk`), and accepts a named interface of loaders. The type check that a second catalog labels every permission and audit action is gone; only the English catalog must label them.

- c4b67b4: Sign-in verifies imported bcrypt password hashes (`$2a$`, `$2b$`, `$2y$`) and replaces one with the current `pbkdf2v1:` format on the first successful sign-in. `importUsers` from `@opulonjs/users/server` creates users with their old hash and roles; see the package README. Adds the `bcryptjs` and `zod` dependencies, the `users.imported` audit action and the `Email` schema export of `@opulonjs/users/api`.
- 49cbf90: An endpoint can require a recent password confirmation. Annotate it with `Sensitive` from `@opulonjs/core/api` (`.annotate(Sensitive, true)`, next to its `Policy`): a session that has not confirmed its password within the window gets 403 `PasswordConfirmationRequired`, after the session and permission checks. `POST /api/users/password-confirmation` with the user's password confirms the session that sent it; it allows 5 attempts a minute per client address, keyed as sign-in keys them (an IPv6 address counts as its /64; invitation acceptance now uses the same key), and writes the audit event `users.password_confirmation_failed` for a wrong password. The window is 5 minutes, or the duration in `USERS_PASSWORD_CONFIRM_WINDOW`. Requests made through `useApiClient` need no code: the admin shell answers the refusal with one password dialog and sends the request once more, and repeats nothing when the user cancels or the route changes. The dialog covers requests under the API prefix only; a host screen calling a route outside it handles the 403 itself. Host routes outside the composed API check the same with `staff.require(request, env, permission, { sensitive: true })`. Migration `0005_session_password_confirmed_at` adds a column to `users.session`. An auth provider gets the dialog by implementing `AuthProvider.confirmPassword`; `usersAdmin()` does. Core's `authorization(authenticate)` accepts `{ user, passwordConfirmed }`; a lookup that returns only a user never passes a `Sensitive` endpoint.
- 15ed652: Host routes outside the composed API can check the staff session. `staffAccess(server, { database })` from `@opulonjs/users/server` returns `session(request, env)`, which resolves with the signed-in staff user and their permissions or `undefined`, and `require(request, env, permission)`, which resolves with the user or with the 401 or 403 response the composed API answers. Both take a plain `Request`, return Promises and read the session and roles from Postgres on every call. `composeServer` takes a `permissions` option with the host's own permission keys; they join the catalog, so the Roles screen offers them. `@opulonjs/core` also exports `holdsPolicy`, and `@opulonjs/core/workers` exports `envConfig`. See the `@opulonjs/users` README for a Nuxt example.
- f02fc85: Staff management gains four actions, each with an endpoint under `/api/users`, a place in the admin and an audit event. A user manager (`users.manage`) edits a user's name and email on the user screen: `PUT /users/:id` with `{ name, email }` answers 409 when another user has the address and 400 for one sign-in would not accept (the rule `importUsers` applies), before anything changes. A changed email ends that user's sessions and cancels the password reset links already sent to the old address (`users.updated`). A manager who changes their own email lands on the sign-in screen. The Users screen lists open invitations under the users table: `GET /invitations` returns every invitation not yet accepted, expired ones marked; `POST /invitations/:id/resend` emails a new link with the same roles and the old link stops working (`users.invited` again); `DELETE /invitations/:id` revokes one (`users.invitation_revoked`). Both refuse an invitation that grants a role the manager may not grant. A role manager (`users.roles.manage`) deletes a role from the role editor: `DELETE /roles/:id` answers 409 while any user holds the role, deactivated users included, and refuses Super admin (`users.role_deleted`). Every signed-in user changes their own password on My account: `PUT /password` with `{ currentPassword, newPassword }` ends the user's other sessions and keeps the one that sent it (`users.password_changed`). It needs no password confirmation; a wrong current password answers 403 `WrongPassword`, counts against the confirmation's 5 attempts a minute per client address and writes `users.password_confirmation_failed`. `UserManagement` gains `updateUser` and `deleteRole`; `Users` gains `invitations`, `resendInvitation`, `revokeInvitation` and `changePassword`. No migration and no new config key.
- 46d314a: A host can put a Cloudflare Turnstile check in front of staff sign-in and password-reset requests, and use the same check on its own forms. With `USERS_TURNSTILE=true` in the Worker env, `POST /api/users/auth/sign-in` and `/api/users/auth/request-password-reset` answer 403 `TurnstileFailed` unless the payload's new `turnstileToken` passes, before any user lookup, password check or rate-limit count. The check needs `USERS_TURNSTILE_SECRET` and `USERS_TURNSTILE_HOSTNAMES` (comma-separated). A siteverify that fails, answers a non-2xx status or does not answer within 5 seconds refuses the request. `usersAdmin({ turnstile: { siteKey } })` shows the widget on the sign-in and forgotten-password screens; when Cloudflare's script does not load they say so and offer a retry. The two sides must agree: the check on without a secret or hostnames, or a request that carries a token while the check is off, answers 403 `TurnstileNotConfigured`, and the screens say the check is not set up. With `USERS_TURNSTILE` unset and no site key, sign-in behaves as before. `Users.requestPasswordReset(headers, email)` takes the token as an optional third argument.

  `verifyTurnstile({ secret, hostnames, action, token })` from the new `@opulonjs/core/turnstile` entry is the server check as a Promise, for a host route: it asks siteverify and compares the action and the hostname. `@opulonjs/ui/components/Turnstile` is the widget for a host form (`v-model` is the token, `site-key` and `action` are props, `reset()` asks for a new token, the `unavailable` slot shows when the script does not load). Cloudflare's dummy keys work for local development: its dummy secrets answer hostname `example.com` and no action, so with one of them those two comparisons are skipped. See the users README.

  Config now reads boolean and number values of the Worker env (a Wrangler `vars` entry such as `USERS_TURNSTILE = true`) as their text; before, only strings were read and such a value fell back to its default without a word. A host that wrote a var in a form its Config key does not accept now fails instead: `USERS_PASSWORD_CONFIRM_WINDOW = 300` as a number was ignored and is now a Config error on sign-in, password reset and every request that reads the session; invitation inspection still answers. Write it as a duration, `"5 minutes"`.

### Patch Changes

- Updated dependencies [6c70812]
- Updated dependencies [0ad9cc4]
- Updated dependencies [ee2530d]
- Updated dependencies [49cbf90]
- Updated dependencies [15ed652]
- Updated dependencies [46d314a]
- Updated dependencies [f69140b]
  - @opulonjs/admin@0.5.0
  - @opulonjs/ui@0.5.0
  - @opulonjs/emails@0.5.0
  - @opulonjs/core@0.5.0

## 0.4.0

### Patch Changes

- @opulonjs/admin@0.4.0
  - @opulonjs/core@0.4.0
  - @opulonjs/emails@0.4.0
  - @opulonjs/ui@0.4.0

## 0.3.0

### Patch Changes

- @opulonjs/admin@0.3.0
  - @opulonjs/core@0.3.0
  - @opulonjs/emails@0.3.0
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
  - @opulonjs/emails@0.2.0
  - @opulonjs/admin@0.2.0
  - @opulonjs/core@0.2.0

## 0.1.0

### Minor Changes

- 6636323: Add a permission-protected audit API, a filterable admin audit log, and reusable subject timelines on user detail screens.

  IP addresses and user agents are masked when events are past the configured IP retention window, even before the retention task runs. Audit paging is capped at offset 10,000; the admin shows the accessible history window and suggests refining filters.

  Breaking for hosts using module IDs `me` or `audit`: composition now rejects these IDs because core owns their root API routes. Rename those host modules before upgrading.

  DataTable adds the optional `maxPage` prop and `error` and `pagination-limit` slots for bounded paging and custom failure and limit messages.

- 16f34ba: Page, sort and search users and collection items on the server. Reference fields use the shared searchable table, retain selected items across pages, and discard stale loads; saved references that were deleted or are not item IDs show as missing and stay removable. Item links pick a collection, then search its items, instead of listing every item in one select; removing the target clears the link. Users list responses now include a total and both list endpoints default to 25 rows with a 100-row maximum and bounded offsets. Both lists take `page`, `perPage`, `search`, `sort` and `direction`; the items list also takes `ids` (up to 100 comma-separated item IDs) and the users list `id` (one user).

  Breaking changes for API consumers:

  - `GET /cms/collections/{collection}/items` and `GET /users/users` (under the host's API prefix, `/api` by default) now return one page, 25 rows by default, instead of every row. Request further pages (`page`, `perPage` up to 100) to read them all.
  - The server services `Items.list(collection, query)` (`@opulonjs/cms/server`) and `UserManagement.users(query)` (`@opulonjs/users/server`) now take a required `query` and return one page with its `total`. Calls without a query, such as `Items.list('posts')`, no longer type-check and fail at runtime.

- 5553449: Add `@opulonjs/users`: staff sign-in with email and password through Better Auth (login and sessions only, PBKDF2 hashes, its own `pg` pool over the SqlClient's URL, session cookie cache off, same-origin `httpOnly`/`SameSite=Lax` cookies, rate limits per client address in the database), invite-only onboarding (`POST /api/users/invitations`, `users.manage`; the invitee sets a password through the emailed link), password reset by email, deactivated users refused, and `users.*` audit events for sign-in, failed sign-in, sign-out, invitations and resets. `users()` implements core's Authorization middleware from the session (permissions from the user's roles; the built-in Super admin holds every composed permission) and reads Config `USERS_BASE_URL` and `USERS_AUTH_SECRET`. `usersAdmin()` is the admin's auth provider with the sign-in, forgotten password, reset and invitation screens. `opulon users invite-super-admin --server <file> --email <address>` prints the first Super admin's invitation link. Core adds module `commands` for the `opulon` CLI (`opulon <module id> <command>`) and exports `Composed`; the admin shell gets a sign-out button (`AuthProvider.signOut`), `useAdmin().refresh()` and re-exports `useRoute`/`useRouter`.
- c7d76fb: Add roles, permissions and deactivation: the `users.roles.manage` permission, roles API (list, create, edit; Super admin is read-only), role assignment, deactivation (revokes sessions) and reactivation, per-user admin locale, and the Users, Roles and My account admin screens in en + sk. An escalation guard refuses granting a permission or Super admin the actor does not hold, acting on a user who holds more, self-lockout and removing the last active Super admin; changes are serialized by one lock and audited.
- fe35a6d: First public release: the seven packages ship together as 0.1.0, proven by the fixture host on real Workers with Hyperdrive, R2 and the cron trigger.

### Patch Changes

- 9b5e748: The sidebar's user block opens a user menu: the user's name and email, account settings, a language submenu and sign-out. The auth provider supplies the account route (`accountRoute`) and saves the language (`setLocale`); the users module no longer lists My account in the nav. Everything clickable shows the pointer cursor, table rows with a row action included.
  Language names start with a capital (`Slovenčina`, `Angličtina`) in the user menu, the account language picker and `LocaleTabs`, through the new `languageName` helper.
- 9775d9c: `useApiClient` called in a component's `setup` drops answers that arrive after that component unmounted: the returned promise never settles, so code after the `await` cannot change a screen, toast or route that moved on. The request itself still completes. Pass `useApiClient(group, { detached: true })` for a call handed to an owner that outlives the component, such as the `save` given to `useAdmin().saveLocale`; the users Account and User screens do.
- d469616: Better Auth no longer prints its log messages or failing errors whole: an unexpected error fails the request and the Worker logs its names and codes (a Postgres error's SQLSTATE included), and Better Auth's other log lines reach the Effect log with their messages dropped. `describeError` (core) is the redaction both use.

  Sign-in refuses a request whose `Origin` is another site (login CSRF), and a session revoked while Better Auth refreshes it answers as signed out instead of a 500.

- e134aff: Fixes from the redeploy smoke. A revalidated admin file (304) is no longer answered with `index.html`, which broke the logo after the first load. A request that ends in a 5xx logs its cause; Better Auth server errors carry their response body. A rate-limited sign-in reports a `retryAfter` within the window: Better Auth's pool now reads `bigint` as a number. The default admin theme follows Kumiba: neutral grays, a black primary in light mode and a white one in dark mode, unless the brand sets its own.
- 82541fe: Review fixes. users: a session is created atomically with deactivation and password reset (migration 0002), invitations are checked and written under the users/roles lock, one pending invitation per address (migration 0003), and accepting an invitation is rate limited per address and checks the token before hashing the password. cms: redirect paths are decoded and canonical (dot segments, repeated slashes) for writes, CSV import and lookup; backslashes and `//` are refused. emails: the retry cap holds when a last attempt was cut off; public emails use core's content locales (the `contentLocales` option is removed); bodies are sanitized with sanitize-html instead of xss. core: composition refuses the Authorization middleware or a Policy on a public group.
- b605844: Review fixes, round 2. cms: SSR drops credentials passed to the in-process cms fetch outside `?preview`, and HTML that read any non-public cms answer is `private, no-store` without Cache-Tag; `resolve` answers non-site paths (encoded `//`, backslashes, control characters) as not found and redirects to canonical paths in one hop, never off the site; in the default locale, redirect paths drop its own prefix and a `from` under another locale's prefix is refused, so a redirect cannot loop through resolve's prefix redirect; the sitemap index links children at `<apiPrefix>/cms/sitemaps/<file>`, and routed collections' sources are `cms.items.<key>`; Cache-Tag headers stay under 8 KiB by collapsing page and item tags into `cms:routes` (also for SSR HTML); a Cloudflare purge's deadline covers its body. users: accepting an invitation takes the users/roles lock first, so it cannot deadlock with a re-invite. emails: every delivery attempt ends at a deadline inside its lease, and Resend's timeout covers the response body.
- 047f45d: The admin shell now shows what the server holds after a sign-out or a language change. Each change ends with a fresh read of `/me` instead of applying its own answer, and only the newest read applies. So a late answer from a previous session, another user or an earlier change can no longer undo a newer state. If that read fails, a ready shell stays up and keeps showing the change for the same user. A read that finds the session ended, a deploy check included, signs the shell out and opens the sign-in screen. A deploy check that shows another account or another language, or answers while a read is still loading, starts a fresh read instead of applying its own answer. New `useAdmin().saveLocale(locale, save)` runs a module's own language save through this path. The account and user screens use it, so they save and apply the language even when the auth provider has no `setLocale`. Module catalogs that load after the admin is unmounted are no longer merged into its messages. Known limits, each needing a failed read or several rare events together: a lost save answer followed by a failed read; a language fallback that is not awaited and can overwrite a deploy check that lands while its catalogs load; a sign-out whose fallback a later save replaces; a write answer that lands after a newer read; and a catalog that fails to load in a signed-in read (tracked in TSPACK-66).
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
- Updated dependencies [b605844]
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
  - @opulonjs/emails@0.1.0
