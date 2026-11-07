---
'@opulonjs/ui': minor
'@opulonjs/cms': patch
'@opulonjs/emails': patch
'@opulonjs/media': patch
'@opulonjs/users': patch
---

Lists keep every column in view and answer the same way on every screen. `DataTable` cells wrap (long words and paths anywhere) instead of Nuxt UI's one line, so a long title or path no longer pushes the columns after it out of the visible box (a collection with long post titles hid Status and Updated on a 1440 px screen); a column with `nowrap: true` stays on one line (statuses, dates, numbers). The first load shows "Loading…" instead of the empty state; a failed load shows its message with a "Try again" button and no empty state (`errorMessage` sets the message; the `error` slot still replaces both); an empty result while a search or filter is active says "Nothing matches the search or filters." with Reset; clickable rows get the pointer cursor.

`formatDate` and `formatDateTime` (medium date, short time, the admin locale) format every list and history date: pages, items, revisions, media and the email log. The cms column reads "Updated" as media's does. Pages sort by any column like a collection's items; the users list sorts by status; email templates open on a row click like every other list and name their languages; the email log and template columns follow a language switch.
