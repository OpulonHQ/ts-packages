---
"@opulonjs/admin": patch
---

An older answer no longer undoes a newer action: a deploy check or refresh still in flight when the user signs out, changes the language or refreshes is dropped, so a sign-out and a saved language stick. Module catalogs that load after the admin is unmounted are no longer merged into its messages.
