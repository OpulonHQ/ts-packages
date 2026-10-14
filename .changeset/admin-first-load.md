---
'@opulonjs/admin': patch
'@opulonjs/media': patch
'@opulonjs/cms': patch
'@opulonjs/ui': patch
---

The admin's first load is about a fifth smaller (1093 kB to 884 kB, 322 kB to 268 kB gzip in the fixture host): the data table, the media picker and the typed API client now load with the screens that use them, and the rich text editor loads only when a cms form shows a rich text field. The editor's ProseMirror code gets its own chunk, so the build no longer warns about a chunk over 500 kB. `@opulonjs/admin`, `@opulonjs/media` and `@opulonjs/cms` declare `"sideEffects": false`.
