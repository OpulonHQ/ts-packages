# Each package owns a Postgres schema; foreign keys only follow dependency edges

Packages share one Postgres database, so each one owns its own schema (`cms`, `media`, `core`, ...), keeps its migrations table inside that schema, and qualifies every table name instead of relying on `search_path`. Foreign keys between packages are allowed only from a package to one it declares as a dependency (never the other way). They default to `RESTRICT`, use `SET NULL` only where a missing reference has a defined meaning, and never `CASCADE` across packages. Audit events have no foreign keys, so they outlive the users and records they mention.

We rejected "no cross-package foreign keys" (integrity checks in services can race) and "foreign keys anywhere" (cycles break per-package migration order and module removal). Decided in TSPACK-6, reviewed independently by gpt-6.1-sol and gpt-6-astra.
