---
'@opulonjs/admin': patch
'@opulonjs/media': patch
'@opulonjs/cms': patch
'@opulonjs/ui': patch
---

The admin's first screen downloads less JavaScript: in the fixture host its first route fetches 920 kB instead of 1110 kB (284 kB instead of 329 kB gzip; CSS unchanged at 203 kB). The data table, the media picker and the typed API client now load with the screens that use them, and the rich text editor loads only when a cms form shows a rich text field. A cms field editor (rich text or a registered widget) that fails to download shows an error with a Reload page action instead of an empty field. `@opulonjs/admin`, `@opulonjs/media` and `@opulonjs/cms` declare `"sideEffects": false`.

The editor's tiptap and ProseMirror code still forms one chunk over Vite's 500 kB warning unless the host splits it. To opt in, add the new `editorChunkGroup` (from `@opulonjs/admin/vite` or `@opulonjs/ui/vite`) to the admin's Vite config: `build: { rolldownOptions: { output: { codeSplitting: { groups: [editorChunkGroup] } } } }`. The presets themselves add no chunking options.
