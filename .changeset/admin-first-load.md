---
'@opulonjs/admin': patch
'@opulonjs/media': patch
'@opulonjs/cms': patch
'@opulonjs/ui': patch
---

The admin's first screen downloads less JavaScript: in the fixture host its first route fetches 920 kB instead of 1110 kB (284 kB instead of 329 kB gzip; CSS unchanged at 203 kB). The data table, the media picker and the typed API client now load with the screens that use them, and the rich text editor loads only when a cms form shows a rich text field. A cms field editor (rich text or a registered widget) that fails to download shows an error with Try again instead of an empty field. `@opulonjs/ui/vite` puts the editor's ProseMirror code in its own chunk, so the build no longer warns about a chunk over 500 kB; a host that sets its own `codeSplitting`, `manualChunks` or `advancedChunks` keeps its chunking. `@opulonjs/admin`, `@opulonjs/media` and `@opulonjs/cms` declare `"sideEffects": false`.
