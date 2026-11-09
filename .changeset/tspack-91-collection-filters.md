---
'@opulonjs/cms': minor
---

A collection's admin list can be filtered by its reference and select fields. Name them in the collection definition (`filters: ['categories']`); `defineCms` refuses a name that is not a reference or select field of the collection. The Collections screen then shows one filter per named field above the table, labelled with the field's label: a select offers its options, a reference the first 100 items of its collection by title. Choosing a value reloads the list from page 1, with search, sort, paging and the total limited to the matching items; Reset clears it. Collections without `filters` look and behave as before.

`GET /collections/:collection/items` takes `filter=<field>:<value>`, repeatable (at most 20, all must match): items whose draft field holds the value, a referenced item id or a select option. A field the collection's `filters` does not name answers 400 `CmsInvalid`.
