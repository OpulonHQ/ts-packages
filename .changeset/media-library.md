---
'@opulonjs/core': minor
'@opulonjs/admin': minor
'@opulonjs/media': minor
---

Add the media library on R2. `media({ maxBytes, widths, imageUrl })` from `@opulonjs/media/server` serves `/api/media`: multipart upload through the Worker into `MediaStorage` (`R2MediaStorage(env.MEDIA_BUCKET)` from the host's infra), a magic-byte allowlist (JPEG, PNG, WebP, AVIF, GIF, PDF; no SVG or video) and a 20 MB default limit, rejected uploads answering `MediaRejected` with a readable message, image dimensions, alt text and captions per content locale, replace (same id, new version and URL, old URL keeps serving), archive and restore (no delete), permissions `media.view`, `media.upload`, `media.archive`, and Audit events for every write. `serveMedia(request, storage)` answers `/media/<id>/<version>/<filename>` with immutable caching; `ImageUrl` builds `/cdn-cgi/image` URLs and `MediaLibrary.resolve(ids, locale)` gives `{ url, alt, caption, width, height, mime, srcset }` for rendering. `@opulonjs/media/admin` adds `mediaAdmin()` (Content > Media) and `MediaPicker`. Core: hosts declare content locales once with `composeServer({ contentLocales })`; modules read them through `ContentLocales`, and `/me` (and the admin's `Me`) now include `contentLocales`.
