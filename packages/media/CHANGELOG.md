# @opulonjs/media

## 0.2.0

### Minor Changes

- 8002758: One language switch per editor instead of a tab strip on every field. While the host has more than one content locale, the page, item, site settings and menu editors show `LocaleSwitch` ("Content language", the language names from `languageName`) above the form, and every localized field, the path, availability and SEO of a page or routed item, and every menu entry's label show the chosen language; the other languages' controls stay mounted and hidden, so nothing typed in them is lost and focus can reach them. The language last chosen holds for every cms editor of the admin until the page reloads, which starts on the first content locale again. Each label shows once (the legend that repeated it is gone). With several content locales a field every language shares says "All languages" next to its label, and a localized control's description names its language for screen readers only (the switch shows it); with one locale there is no switch and neither. The page editor's switch and its preview language are one value: changing either changes both, and a click in the preview turns the editor to the preview's language before focusing the field. A save or publish the server refuses for a value of one language turns the editor to that language, read from the message (`at ["title"]["it"]`, "The it path …", "… is required in en.", "… needs a label in en."). The revision shown under an editor follows its language and has its own switch over the content locales and any other locale its snapshot holds; a language the snapshot lacks shows empty, and one only the snapshot holds is chosen in the revision alone, leaving the editor's language as it was. Stored data, the API and form field names are unchanged.

  Host field widgets now receive `hint`: "All languages" on a field every language shares while there are several content locales, unset otherwise. Declare it (`hint?: string` in `defineProps`) and show it next to the label, as `CmsWidgetProps` documents; a widget that does not declare it, and keeps `inheritAttrs`, gets it as a `hint` attribute on its root element. A localized widget gets no language: the built-in ones read it out through `srHint`.

  `LocaleSwitch` is native radios in a radiogroup named "Content language" (or `label`), underlined like `LocaleTabs`, and renders nothing for fewer than two locales. `FieldProps` takes `srHint`: in the control's description (`aria-describedby`) but not shown, ignored next to `hint`. `FieldToggle` describes its switch by its description, `hint` (now shown at the end of the switch's row, where it was dropped before), `srHint` and help, all outside the switch's label; a form error replaces that description while it shows. `MediaPicker` takes `hint` and `srHint` and is a group named by its label and described by them.

  The rich text editor's editable area takes its accessible name from the field's label and its description (hint, help, error) from the form field, as Nuxt UI's own inputs do: `RichTextControl` takes a `label`.

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

- 9acc196: Add the cms Read API, public and unauthenticated under `/api/cms`: `resolve?path=` answers a page, item, redirect or not-found union per public path (default content locale unprefixed, others prefixed with the locale), `site?locale=` the published settings, menus with resolved hrefs and the system pages map, `collections/:key` published items with paging, sort, `ref` and `ids` filters, and `sitemap.xml` with one `/api/cms/sitemaps/<key>.xml` child per `sitemapSource` contribution (cms contributes `cms.pages` and `cms.items.<collection>` for routed collections). Media ids resolve to `ResolvedMedia` (now a schema in `@opulonjs/media/api`) and link fields to hrefs. Answers carry `Cache-Control` and `Cache-Tag`; publish, unpublish, delete and redirect writes purge the tags after commit, and `workersCachePurge(ctx)` purges them from the Worker's own Workers Cache. `resolveLinks` now returns `{ href, tags }` with public paths, and a default-locale path may no longer start with another locale's prefix.
- 6a1cb67: Add the media library on R2. `media({ maxBytes, widths, imageUrl })` from `@opulonjs/media/server` serves `/api/media`: multipart upload through the Worker into `MediaStorage` (`R2MediaStorage(env.MEDIA_BUCKET)` from the host's infra), a magic-byte allowlist (JPEG, PNG, WebP, AVIF, GIF, PDF; no SVG or video) and a 20 MB default limit, rejected uploads answering `MediaRejected` with a readable message, image dimensions, alt text and captions per content locale, replace (same id, new version and URL, old URL keeps serving), archive and restore (no delete), permissions `media.view`, `media.upload`, `media.archive`, and Audit events for every write. `serveMedia(request, storage)` answers `/media/<id>/<version>/<filename>` with immutable caching; `ImageUrl` builds `/cdn-cgi/image` URLs and `MediaLibrary.resolve(ids, locale)` gives `{ url, alt, caption, width, height, mime, srcset }` for rendering. `@opulonjs/media/admin` adds `mediaAdmin()` (Content > Media) and `MediaPicker`. Core: hosts declare content locales once with `composeServer({ contentLocales })`; modules read them through `ContentLocales`, and `/me` (and the admin's `Me`) now include `contentLocales`.
- fbd8cac: Purge cached Read API answers after media metadata edits, replacements, archive, and restore. Answers include media dependency tags, with a broad media fallback for oversized headers.

  Core now owns a durable cache purge outbox with three attempts, a bounded scheduled sweep, and a 20-second attempt deadline. CMS and media editors see pending and exhausted failures until cached answers expire. Move host imports of `workersCachePurge` to `@opulonjs/core/workers` and custom purge layers from CMS `CachePurge` to core `CachePurger`; adapters must fail on errors or refusals.

  Core exposes sanitized purge status at `GET /api/cache-purges` for permissions declared by producer modules through `cachePurgeStatusAccess`. The CMS status route is removed. Admin exports `CachePurgeNotice`, shared by CMS and media screens.

- fe35a6d: First public release: the seven packages ship together as 0.1.0, proven by the fixture host on real Workers with Hyperdrive, R2 and the cron trigger.

### Patch Changes

- 5abf4a7: The admin's first screen downloads less JavaScript: in the fixture host its first route fetches 920 kB instead of 1110 kB (284 kB instead of 329 kB gzip; CSS unchanged at 203 kB). The data table, the media picker and the typed API client now load with the screens that use them, and the rich text editor loads only when a cms form shows a rich text field. A cms field editor (rich text or a registered widget) that fails to download shows an error with a Reload page action instead of an empty field. `@opulonjs/admin`, `@opulonjs/media` and `@opulonjs/cms` declare `"sideEffects": false`.

  The editor's tiptap and ProseMirror code still forms one chunk over Vite's 500 kB warning unless the host splits it. To opt in, add the new `editorChunkGroup` (from `@opulonjs/admin/vite` or `@opulonjs/ui/vite`) to the admin's Vite config: `build: { rolldownOptions: { output: { codeSplitting: { groups: [editorChunkGroup] } } } }`. The presets themselves add no chunking options.

- 56c8af5: A media item uploaded through `MediaPicker` stays selected when the upload finishes while its cms editor saves, publishes or restores a revision: a disabled picker holds the upload and picks it once enabled, and the editors keep their lock until the response is on screen, through both requests of save-then-publish. The picker also ignores a lookup for a selection that changed meanwhile.

  A `MediaPicker` instance now belongs to one field. A host that reuses one instance for several fields (rebinding `v-model` to another field) must key it by the field, e.g. `<MediaPicker :key="field" v-model="values[field]" />`, so an upload held for one field is dropped with its instance instead of landing in the next one. The cms editors already unmount their fields when the document changes.

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
