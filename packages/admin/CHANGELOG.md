# @opulonjs/admin

## 0.3.0

### Patch Changes

- @opulonjs/core@0.3.0
  - @opulonjs/ui@0.3.0

## 0.2.0

### Minor Changes

- 516ae41: The sidebar lists what you can open and keeps your place. A `NavItem` takes `children` (`NavChild`: a message key or a name per admin locale, and route params): the item becomes an expandable group whose entries open its route with their params, drawn as a tree (a line down the side, a rounded branch and a dot into each entry, darker on the current one), and a group opens itself when you are in it and otherwise stays as you left it. cms lists every collection under Collections and every menu under Menus, so their screens lose the row of tab buttons and take the collection's or menu's name as their title. A route's `nav` names the nav entry a screen without one belongs to (`cms.page` → Pages, `cms.item` → Collections, `users.user` → Users, `emails.template` → Email templates), and `useNavTarget()` names the exact entry when the route cannot (an item editor names its collection); the entry stays highlighted and the navbar shows its name on detail screens, where it was empty. Content reads Pages, Collections, Menus, Media, Redirects, Site settings in every host (`order` 10 to 60); a host's own Content item with the default `order` 0 now sorts above Pages, so give it an `order` above 60 to keep it after them. Nav items without a `group` now show next to Dashboard as documented; they were dropped whenever another group existed. The user screen gets a breadcrumb back to Users.

  `Brand` takes `wordmark` (a wide logo that includes the name, shown instead of mark and name in the open sidebar) and `wordmarkDark`, and `logoDark` for the square mark.

- 8f1f383: Every editor saves and asks the same way. `useCloseGuard({ isOpen, close, dirty })` guards a slideover that holds a small record's form: bound as `v-model:open`, `:dismissible` and `@close:prevent`, it makes Cancel, ×, Escape and an outside click ask "Discard unsaved changes?" while the form has unsaved changes and close at once while it has none, and `leave()` asks the same before another row or a new record replaces the form (one question at a time, so its answer applies to the request that asked). `useUnsavedChanges` takes `within` (the element holding a form inside a dialog: Cmd/Ctrl+S saves while that dialog is open, but not behind another dialog over it, such as a delete confirmation) and `guardWhileBusy` (leaving keeps asking while a save of several requests runs, since leaving would cut it short).

  Roles, invitations and redirects open in a slideover instead of a card above the list: the form in the body, its message at the top (success green, failure red), Cancel and the primary action ("Save", "Send the invitation"; Delete for an existing redirect, whose confirmation now says what deleting does) in the footer. Each form registers with `useUnsavedChanges({ bar: false, within })`, so leaving the screen asks and Cmd/Ctrl+S saves it from inside the slideover; a new role or invitation with nothing typed has no unsaved changes, and a role's permissions compare as a set, so unchecking and checking one again is no change. A saved role, a sent invitation or a saved or deleted redirect closes the slideover and says so above the list; Super admin still only explains that it cannot be edited; Import CSV stays in the header. The media details slideover asks the same before it closes or another item opens while alt text or a caption is unsaved, and an upload asks before it starts; that text survives Replace file, Archive and Restore, Cmd/Ctrl+S saves it, and the fields are locked while a request runs.

  The user screen's roles save from the unsaved-changes bar ("Save roles" is gone), and a language change, a deactivation, a reactivation or a refused save no longer resets unsaved role toggles; the admin language still applies at once; messages are green or red. The email template editor saves from the bar: Save stores every language whose subject or body differs from what emails use (its override, else the default), one after another, with the fields locked meanwhile and leaving asking until the last one is stored; a refused language keeps its changes, shows why and opens its tab while the others save, and Discard puts every language back. The per-language Save button is gone; Preview, Send me a test and Reset to default stay, and a language with unsaved changes notes that the test uses the saved wording. "Send this email" still applies at once and now says whether it was saved (a failure turned it back without a word); Reset to default waits in its dialog until done.

- d3f7e8a: Unsaved changes are never missed. `useUnsavedChanges({ current, saved, save, discard, busy?, saveLabel?, bar? })` registers an editor with the shell: while what is on screen differs from what was saved (`sameContent`: empty values a form writes on its own, `null`, `''`, `false`, `[]` and `{}`, do not count), the shell shows `UnsavedChangesBar` under the screen (always in view) with "Unsaved changes", Discard (asks first, then puts the saved values back without a request) and the editor's Save; Cmd/Ctrl+S saves (not behind an open dialog); a polite live region announces the bar; leaving for another path, signing out or reloading asks "Discard unsaved changes?" once (not for a redirect a guard starts, not after the session ended, not while the editor's own save is in flight, which carries its changes); the new-version Reload asks too. `useLeaveGuard(dirty)` adds state that saves on its own (a widget) to the guard without the bar; `confirmDiscard()` asks before an in-screen switch replaces edits.

  The page, item, site settings and menu editors use it: "Save draft" moves from the header to the bar, and the header keeps the status, Publish (saves what is on screen first), Unpublish and Delete. The page editor uses `PublishActions` like the others. Unpublish asks first ("Take it off the website?") and no longer replaces edits on screen with the saved draft. The cache-purge notice sits under the header on every editor.

### Patch Changes

- Updated dependencies [5d53e23]
- Updated dependencies [8002758]
- Updated dependencies [516ae41]
- Updated dependencies [d3f7e8a]
  - @opulonjs/ui@0.2.0
  - @opulonjs/core@0.2.0

## 0.1.0

### Minor Changes

- 75a1754: Add the admin skeleton: `defineAdminModule`, `createAdmin` (hides modules missing from `/me`, reload notice on a new build), `useApiClient` for a module's own HttpApi group, and the `opulonAdmin()` Vite preset in `@opulonjs/admin/vite` (build id and API prefix injection). Core adds a minimal `/me` (build id, enabled module ids; `createWorker` now takes `buildId`), `serveAdmin` in `@opulonjs/core/workers` for the `/admin` SPA fallback and immutable assets, and the client-safe `@opulonjs/core/api` entry for module `/api` files.
- 6636323: Add a permission-protected audit API, a filterable admin audit log, and reusable subject timelines on user detail screens.

  IP addresses and user agents are masked when events are past the configured IP retention window, even before the retention task runs. Audit paging is capped at offset 10,000; the admin shows the accessible history window and suggests refining filters.

  Breaking for hosts using module IDs `me` or `audit`: composition now rejects these IDs because core owns their root API routes. Rename those host modules before upgrading.

  DataTable adds the optional `maxPage` prop and `error` and `pagination-limit` slots for bounded paging and custom failure and limit messages.

- 7a40f65: Add the rest of core: the `core()` module (hosts list it), `Audit.record` and `diffFields` writing `core.audit_event` in the caller's transaction, the daily `core.audit_purge` retention task (365 days, IP/UA nulled after 90, configurable via `core({ audit })`), `requirePermission` with an anonymous-by-default `CurrentActor` (the Authorization middleware sets the signed-in user, tasks run as the system actor), Effect `Config` read from the Worker env's string values only, and a staff-only `/me` (`private, no-store`) returning the user, admin locale, permission keys, enabled module ids, the permission catalog and the build id. `CurrentUser` now carries `name`, `email` and `locale`; `systemActor` is now a function taking the actor name. The admin's `Me` type follows the richer `/me`.
- a6b8976: Email template overrides: `emailsAdmin()` adds an email templates screen (permission `emails.templates.manage`) listing every contributed template with its audience, placeholders and per-locale override state, and an editor to override subject and body per locale, insert placeholders and email components, preview with sample values, send a test to yourself through the outbox, reset to the default and turn a template off (its sends are logged as `skipped`). Overrides are sanitized to the restricted rich text format on save and at render; edits and test sends are audited (`emails.template.*`). Email components are written as `[[name prop="value"]]` in bodies (code defaults included) and rendered at send time: the package ships `button`, `callout`, `divider` and `table`, and hosts add their own with `emails({ components: [emailComponent({ name, props, render })] })`. `@opulonjs/admin` re-exports `useRoute` and `RouterLink` for module screens; `RichTextControl` exposes `insert(content)`.
- 6a1cb67: Add the media library on R2. `media({ maxBytes, widths, imageUrl })` from `@opulonjs/media/server` serves `/api/media`: multipart upload through the Worker into `MediaStorage` (`R2MediaStorage(env.MEDIA_BUCKET)` from the host's infra), a magic-byte allowlist (JPEG, PNG, WebP, AVIF, GIF, PDF; no SVG or video) and a 20 MB default limit, rejected uploads answering `MediaRejected` with a readable message, image dimensions, alt text and captions per content locale, replace (same id, new version and URL, old URL keeps serving), archive and restore (no delete), permissions `media.view`, `media.upload`, `media.archive`, and Audit events for every write. `serveMedia(request, storage)` answers `/media/<id>/<version>/<filename>` with immutable caching; `ImageUrl` builds `/cdn-cgi/image` URLs and `MediaLibrary.resolve(ids, locale)` gives `{ url, alt, caption, width, height, mime, srcset }` for rendering. `@opulonjs/media/admin` adds `mediaAdmin()` (Content > Media) and `MediaPicker`. Core: hosts declare content locales once with `composeServer({ contentLocales })`; modules read them through `ContentLocales`, and `/me` (and the admin's `Me`) now include `contentLocales`.
- c2e96ad: Allow hosts to replace admin screens by route name using components or lazy loaders, and UI kit components through the Vite preset. Warn when copied source headers precede the installed package version, when a header is malformed, when registered copies or imported files under the Vite root's `overrides/` directories lack a header, or when the package version cannot be checked. These checks run when the preset's `overrides` option is set (`overrides: {}` for screen copies only).

  The built-in Dashboard is now a separate lazy chunk for every host, so an overridden Dashboard never downloads the original.

  Keep Effect outside dependency prebundling when component overrides are configured.

  Show a retryable error above the current screen when the latest navigation fails, because its screen does not load or a global or enter guard throws (a screen's own leave-guard error stays in the console), and re-check the server build so a deploy prompts a reload. Try again opens the failed address with a fresh page load, also when only its `#fragment` differs from the current address.

- fbd8cac: Purge cached Read API answers after media metadata edits, replacements, archive, and restore. Answers include media dependency tags, with a broad media fallback for oversized headers.

  Core now owns a durable cache purge outbox with three attempts, a bounded scheduled sweep, and a 20-second attempt deadline. CMS and media editors see pending and exhausted failures until cached answers expire. Move host imports of `workersCachePurge` to `@opulonjs/core/workers` and custom purge layers from CMS `CachePurge` to core `CachePurger`; adapters must fail on errors or refusals.

  Core exposes sanitized purge status at `GET /api/cache-purges` for permissions declared by producer modules through `cachePurgeStatusAccess`. The CMS status route is removed. Admin exports `CachePurgeNotice`, shared by CMS and media screens.

- 4847ec7: Add the UI kit and the admin shell. `@opulonjs/ui` wraps Nuxt UI 4: kit components at `@opulonjs/ui/components/<Name>` (DataTable, LocaleTabs, ConfirmDialog, StatusBadge, PageHeader, EmptyState, StatCard, RichTextControl, `Field/Text`, `Field/Textarea`, `Field/Number`, `Field/Select`, `Field/Toggle`, `Field/RichText`), built one file per component, en/sk kit strings, re-exports of the Nuxt UI components admin screens use, and the `opulonUi()` Vite preset in `@opulonjs/ui/vite` (build-time brand: palettes, radius, font, component overrides; self-hosted Inter; offline Lucide bundle, no Iconify API calls). `createAdmin` now renders a Nuxt UI dashboard: nav groups (Content, Users, Settings, host groups by order), dashboard widgets, nav, routes and widgets filtered by `/me` permissions, sign-in routing through exactly one auth provider, en + sk messages extensible by the host, and the user's admin locale. `defineAdminModule` takes the module's `permissions` and `auditActions` catalogs and then requires en and sk labels (`permissions.<key>`, `audit.<key>`) for every key at type level. `useAdmin()` exposes the signed-in user and `can(permission)` to module screens. `opulonAdmin({ brand })` applies the brand at build time.
- 5553449: Add `@opulonjs/users`: staff sign-in with email and password through Better Auth (login and sessions only, PBKDF2 hashes, its own `pg` pool over the SqlClient's URL, session cookie cache off, same-origin `httpOnly`/`SameSite=Lax` cookies, rate limits per client address in the database), invite-only onboarding (`POST /api/users/invitations`, `users.manage`; the invitee sets a password through the emailed link), password reset by email, deactivated users refused, and `users.*` audit events for sign-in, failed sign-in, sign-out, invitations and resets. `users()` implements core's Authorization middleware from the session (permissions from the user's roles; the built-in Super admin holds every composed permission) and reads Config `USERS_BASE_URL` and `USERS_AUTH_SECRET`. `usersAdmin()` is the admin's auth provider with the sign-in, forgotten password, reset and invitation screens. `opulon users invite-super-admin --server <file> --email <address>` prints the first Super admin's invitation link. Core adds module `commands` for the `opulon` CLI (`opulon <module id> <command>`) and exports `Composed`; the admin shell gets a sign-out button (`AuthProvider.signOut`), `useAdmin().refresh()` and re-exports `useRoute`/`useRouter`.
- fe35a6d: First public release: the seven packages ship together as 0.1.0, proven by the fixture host on real Workers with Hyperdrive, R2 and the cron trigger.

### Patch Changes

- 5695e71: The admin Vite dev server starts from installed packages with the stock `opulonAdmin()` preset: the host's `@opulonjs/*` packages (from any dependency field) and `effect` are no longer prebundled (before, only with component overrides), so the kit no longer imports Nuxt UI from the host root.
- 5abf4a7: The admin's first screen downloads less JavaScript: in the fixture host its first route fetches 920 kB instead of 1110 kB (284 kB instead of 329 kB gzip; CSS unchanged at 203 kB). The data table, the media picker and the typed API client now load with the screens that use them, and the rich text editor loads only when a cms form shows a rich text field. A cms field editor (rich text or a registered widget) that fails to download shows an error with a Reload page action instead of an empty field. `@opulonjs/admin`, `@opulonjs/media` and `@opulonjs/cms` declare `"sideEffects": false`.

  The editor's tiptap and ProseMirror code still forms one chunk over Vite's 500 kB warning unless the host splits it. To opt in, add the new `editorChunkGroup` (from `@opulonjs/admin/vite` or `@opulonjs/ui/vite`) to the admin's Vite config: `build: { rolldownOptions: { output: { codeSplitting: { groups: [editorChunkGroup] } } } }`. The presets themselves add no chunking options.

- 66b5358: `opulonAdmin()` finds the admin screens of every installed `@opulonjs/*` package (an `./admin` export in the host's package.json dependencies) and scans them for icons and Tailwind classes. A host no longer lists package directories in `sources`; before, a package left out (or every package, when installed from npm) rendered its buttons and nav items without icons.
- 9b5e748: The sidebar's user block opens a user menu: the user's name and email, account settings, a language submenu and sign-out. The auth provider supplies the account route (`accountRoute`) and saves the language (`setLocale`); the users module no longer lists My account in the nav. Everything clickable shows the pointer cursor, table rows with a row action included.
  Language names start with a capital (`Slovenčina`, `Angličtina`) in the user menu, the account language picker and `LocaleTabs`, through the new `languageName` helper.
- 9775d9c: `useApiClient` called in a component's `setup` drops answers that arrive after that component unmounted: the returned promise never settles, so code after the `await` cannot change a screen, toast or route that moved on. The request itself still completes. Pass `useApiClient(group, { detached: true })` for a call handed to an owner that outlives the component, such as the `save` given to `useAdmin().saveLocale`; the users Account and User screens do.
- 16f34ba: An unmounted admin stays inert: late message catalogs no longer switch the document language, it stops following the browser history, a navigation that resumes late neither redirects nor rolls the URL back, a late deploy check or screen load failure no longer updates its state or starts another check, and a sign-out or language change that answers late no longer redirects or replaces the signed-in user.
- 0fd36d5: Reject audit Through dates after 9999-12-30 with localized validation and share the default audit page size. Trim exact-match audit filters and ignore whitespace-only values.
- 047f45d: The admin shell now shows what the server holds after a sign-out or a language change. Each change ends with a fresh read of `/me` instead of applying its own answer, and only the newest read applies. So a late answer from a previous session, another user or an earlier change can no longer undo a newer state. If that read fails, a ready shell stays up and keeps showing the change for the same user. A read that finds the session ended, a deploy check included, signs the shell out and opens the sign-in screen. A deploy check that shows another account or another language, or answers while a read is still loading, starts a fresh read instead of applying its own answer. New `useAdmin().saveLocale(locale, save)` runs a module's own language save through this path. The account and user screens use it, so they save and apply the language even when the auth provider has no `setLocale`. Module catalogs that load after the admin is unmounted are no longer merged into its messages. Known limits, each needing a failed read or several rare events together: a lost save answer followed by a failed read; a language fallback that is not awaited and can overwrite a deploy check that lands while its catalogs load; a sign-out whose fallback a later save replaces; a write answer that lands after a newer read; and a catalog that fails to load in a signed-in read (tracked in TSPACK-66).
- cdd3b8b: An unmounted admin no longer changes the page around it. A language save that fails after the admin unmounted shows no error toast in the admin mounted after it, and a sign-in or any other router navigation that resolves after the unmount leaves the browser URL where the host moved it. Language saves from one admin now run one at a time, each after the previous one answered, so the language picked last in that admin is the one the server keeps. A second pick waits for the first save's answer before it is sent. A pick still waiting when the admin unmounts, or after the shell has shown a sign-out or another user since the pick, is not sent, and it no longer holds back the language shown after that. While a pick waits, the shell keeps the language it shows and still applies everything else the server answers, such as a sign-out or a new deploy. Admins on one page never wait for each other's saves, and when two of them save a language, the save that reaches the server last wins, as before.
- Updated dependencies [2cfa7cb]
- Updated dependencies [5695e71]
- Updated dependencies [5abf4a7]
- Updated dependencies [75a1754]
- Updated dependencies [9b5e748]
- Updated dependencies [d469616]
- Updated dependencies [6636323]
- Updated dependencies [7a40f65]
- Updated dependencies [e134aff]
- Updated dependencies [989b8f8]
- Updated dependencies [a6b8976]
- Updated dependencies [6a1cb67]
- Updated dependencies [82541fe]
- Updated dependencies [358c403]
- Updated dependencies [16f34ba]
- Updated dependencies [fbd8cac]
- Updated dependencies [0fd36d5]
- Updated dependencies [5f8d9d9]
- Updated dependencies [b19c299]
- Updated dependencies [0832d55]
- Updated dependencies [4847ec7]
- Updated dependencies [5553449]
- Updated dependencies [fe35a6d]
- Updated dependencies [2130809]
  - @opulonjs/core@0.1.0
  - @opulonjs/ui@0.1.0
