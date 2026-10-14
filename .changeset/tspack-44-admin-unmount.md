---
"@opulonjs/admin": patch
---

An unmounted admin stays inert: late message catalogs no longer switch the document language, it stops following the browser history, a navigation that resumes late neither redirects nor rolls the URL back, and a late deploy check or screen load failure no longer updates its state or starts another check.
