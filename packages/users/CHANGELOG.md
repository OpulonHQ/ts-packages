# @opulonjs/users

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
