# @opulonjs/media

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
