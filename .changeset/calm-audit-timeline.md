---
'@opulonjs/core': minor
'@opulonjs/admin': minor
'@opulonjs/users': minor
'@opulonjs/ui': minor
---

Add a permission-protected audit API, a filterable admin audit log, and reusable subject timelines on user detail screens.

IP addresses and user agents are masked when events are past the configured IP retention window, even before the retention task runs. Audit paging is capped at offset 10,000; the admin shows the accessible history window and suggests refining filters.

Breaking for hosts using module IDs `me` or `audit`: composition now rejects these IDs because core owns their root API routes. Rename those host modules before upgrading.

DataTable adds the optional `maxPage` prop and `error` and `pagination-limit` slots for bounded paging and custom failure and limit messages.
