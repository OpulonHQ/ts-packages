---
'@opulonjs/cms': patch
'@opulonjs/media': patch
---

A media item uploaded through `MediaPicker` stays selected when the upload finishes while its cms editor saves, publishes or restores a revision: a disabled picker holds the upload and picks it once enabled, and the editors keep their lock until the response is on screen, through both requests of save-then-publish. The picker also ignores a lookup for a selection that changed meanwhile.

A `MediaPicker` instance now belongs to one field. A host that reuses one instance for several fields (rebinding `v-model` to another field) must key it by the field, e.g. `<MediaPicker :key="field" v-model="values[field]" />`, so an upload held for one field is dropped with its instance instead of landing in the next one. The cms editors already unmount their fields when the document changes.
