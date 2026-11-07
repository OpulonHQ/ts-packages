---
'@opulonjs/admin': minor
'@opulonjs/ui': minor
'@opulonjs/cms': minor
---

Unsaved changes are never missed. `useUnsavedChanges({ current, saved, save, discard, busy?, saveLabel?, bar? })` registers an editor with the shell: while what is on screen differs from what was saved (`sameContent`: empty values a form writes on its own, `null`, `''`, `false`, `[]` and `{}`, do not count), the shell shows `UnsavedChangesBar` under the screen (always in view) with "Unsaved changes", Discard (asks first, then puts the saved values back without a request) and the editor's Save; Cmd/Ctrl+S saves; leaving for another path or reloading asks "Discard unsaved changes?" once (not for a redirect a guard starts, not after the session ended, not while the editor's own save is in flight, which carries its changes); the new-version Reload asks too. `useLeaveGuard(dirty)` adds state that saves on its own (a widget) to the guard without the bar; `confirmDiscard()` asks before an in-screen switch replaces edits.

The page, item, site settings and menu editors use it: "Save draft" moves from the header to the bar, and the header keeps the status, Publish (saves what is on screen first), Unpublish and Delete. The page editor uses `PublishActions` like the others. Unpublish asks first ("Take it off the website?") and no longer replaces edits on screen with the saved draft. The cache-purge notice sits under the header on every editor.
