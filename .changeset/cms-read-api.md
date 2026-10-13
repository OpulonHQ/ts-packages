---
'@opulonjs/cms': minor
'@opulonjs/media': minor
---

Add the cms Read API, public and unauthenticated under `/api/cms`: `resolve?path=` answers a page, item, redirect or not-found union per public path (default content locale unprefixed, others prefixed with the locale), `site?locale=` the published settings, menus with resolved hrefs and the system pages map, `collections/:key` published items with paging, sort, `ref` and `ids` filters, and `sitemap.xml` with one `/sitemaps/<key>.xml` child per `sitemapSource` contribution (cms contributes pages and routed collections). Media ids resolve to `ResolvedMedia` (now a schema in `@opulonjs/media/api`) and link fields to hrefs. Answers carry `Cache-Control` and `Cache-Tag`; publish, unpublish, delete and redirect writes purge the tags after commit, and `cloudflareCachePurge()` purges through the Cloudflare API. `resolveLinks` now returns `{ href, tags }` with public paths, and a default-locale path may no longer start with another locale's prefix.
