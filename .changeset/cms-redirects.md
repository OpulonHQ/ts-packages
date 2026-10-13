---
'@opulonjs/cms': minor
---

Add cms redirects: exact-path rules per content locale (`from` → `to`, 301 or 302, trailing slash ignored). Publishing a page whose path changed redirects the old path to the new one in the same transaction, and drops redirects from paths the page now answers at. The set stays flat: a redirect onto a redirected path points at its final target, and loops, repeated `from` paths and `from` paths of published pages are refused (409). Editors manage redirects under Content > Redirects and import a CSV file with a `from,to[,status][,locale]` header (at most 5,000 rows, 1 MB), getting created / skipped / per-row errors back. Every write is an Audit event (`cms.redirect.created`, `updated`, `deleted`, `imported`). Permissions: `cms.redirects.view`, `cms.redirects.edit`. `Redirects.lookup(locale, path)` from `@opulonjs/cms/server` returns the redirect for a request path, for the Read API.
