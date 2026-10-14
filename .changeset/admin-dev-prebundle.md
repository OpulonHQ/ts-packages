---
'@opulonjs/admin': patch
'@opulonjs/ui': patch
---

The admin Vite dev server starts from installed packages with the stock `opulonAdmin()` preset: `@opulonjs/*` packages and `effect` are no longer prebundled (before, only with component overrides), so the kit no longer imports Nuxt UI from the host root.
