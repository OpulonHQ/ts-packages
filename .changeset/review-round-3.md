---
'@opulonjs/cms': patch
---

Review fixes, round 3. Redirect paths still under a locale prefix after the default locale's own prefix is dropped (`/en/en/x`, `/en/it/x`) are refused, in the admin and per row in CSV import, so they cannot loop through resolve. An answer whose Cache-Tag header stays over 8 KiB after collapsing (Read API or SSR HTML) is `private, no-store` without Cache-Tag. Page, item and redirect paths share one 1,024-character limit, refused on write and applied by `resolve` after the locale prefix.
