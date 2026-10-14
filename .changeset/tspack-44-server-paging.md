---
"@opulonjs/core": minor
"@opulonjs/users": minor
"@opulonjs/cms": minor
---

Page, sort and search users and collection items on the server. Reference fields use the shared searchable table, retain selected items across pages, and discard stale loads. Users list responses now include a total and both list endpoints default to 25 rows with a 100-row maximum and bounded offsets.

Breaking changes for API consumers:

- `GET /collections/{collection}/items` and `GET /users/users` now return one page, 25 rows by default, instead of every row. Request further pages (`page`, `perPage` up to 100) to read them all.
- The server services `Items.list(collection, query)` (`@opulonjs/cms/server`) and `UserManagement.users(query)` (`@opulonjs/users/server`) now take a required `query` and return one page with its `total`. Calls without a query, such as `Items.list('posts')`, no longer type-check and fail at runtime.
