---
'@opulonjs/cms': patch
---

`cmsNitroHooks` gains `renderRoute` for Nuxt's `render:route` hook: a page rendered with the cms is no longer streamed (`experimental.ssrStreaming`), so its Cache-Tags still reach its headers; a streamed page that slips through answers `private, no-store`. The hooks now typecheck against H3's event in a Nuxt app.
