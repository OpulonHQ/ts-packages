---
'@opulonjs/ui': minor
'@opulonjs/admin': minor
---

Add five form fields to the UI kit, each with the `Field/*` props (label, error, disabled) and replaceable through `overrides.components`:

- `Field/Date`: a `YYYY-MM-DD` day in the native date input.
- `Field/DateTime`: an ISO 8601 UTC instant, edited in the native date and time input in the browser's time zone.
- `Field/Money`: the user types a decimal amount (`12.50` or `12,50`), the model is the integer number of minor units of `currency` (1250 for EUR, 12 for JPY). The number of decimals comes from `Intl`; no floating-point math. The input takes only text that is such an amount: an edit or a paste that is not one changes nothing, so the text shown always is the model.
- `Field/File`: one `File` from the native file input, printed from the model with a Remove button; the native input always holds the model's file, or none. A file over `maxSize` (bytes) or outside `accept` is refused with a message until the choice changes. Sending the file is the screen's job.
- `Field/Relation`: the screen passes `search(term)`, which answers the options (usually from the server); the field calls it when the list opens and 250 ms after the last keystroke, drops an answer that a newer search or a newer keystroke superseded, and offers options only once the current request has answered. An optional value has a Clear button, disabled with the field and the form. `item` gives the label of a value that is already set.

`DataTable` gains `dateFilters` (a From and a To day per filter; `load` gets them as the new optional `query.dateRanges`, client mode filters by the row value's local day) and `reorderable` (a drag handle plus Move up and Move down buttons per row, a screen-reader announcement of the new position, and a `reorder` event with the rows in their new order: all of `rows` in client mode, the current page's rows in server mode). Reorder is off while a search, a filter or a sort is active, and in server mode until the answer of the current query shows. A move names its rows by object identity: a row that no longer shows moves nothing. Saving the order is the screen's job. New type exports: `DataTableDateFilter`, `DateRange`.

`useUnsavedChanges` and `sameContent` in `@opulonjs/admin` now see a picked or replaced `File` as a change.
