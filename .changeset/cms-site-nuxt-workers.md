---
'@opulonjs/cms': patch
---

`cmsNitroHooks` gains `renderRoute` for Nuxt's `render:route` hook: on Workers no page is streamed (`experimental.ssrStreaming`), cms reads or not, because which pages read the cms is known only once they render; this keeps every page's Cache-Tags on its headers. A streamed page that slips through answers `private, no-store` and loses any `Cache-Tag`, in any header case and on headers H3 already holds. A host `Cache-Control` in any case is kept. `?preview` forwards the session only to the page's own origin. The hooks now typecheck against H3's event in a Nuxt app.
