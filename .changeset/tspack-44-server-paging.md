---
"@opulonjs/core": minor
"@opulonjs/users": minor
"@opulonjs/cms": minor
---

Page, sort and search users and collection items on the server. Reference fields use the shared searchable table, retain selected items across pages, and discard stale loads. Users list responses now include a total and both list endpoints default to 25 rows with a 100-row maximum and bounded offsets.

Breaking change for API consumers: the collection items list now returns one page, default 25 rows, instead of every row. Consumers must request subsequent pages to read the full collection.
