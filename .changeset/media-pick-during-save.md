---
'@opulonjs/cms': patch
'@opulonjs/media': patch
---

A media item uploaded through `MediaPicker` stays selected when the upload finishes while its cms editor saves, publishes or restores a revision: a disabled picker holds the upload and picks it once enabled, and the editors keep their lock until the response is on screen, through both requests of save-then-publish. The picker also ignores a lookup for a selection that changed meanwhile.
