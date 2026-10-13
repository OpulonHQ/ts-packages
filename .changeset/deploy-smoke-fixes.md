---
'@opulonjs/core': patch
'@opulonjs/users': patch
'@opulonjs/ui': patch
---

Fixes from the redeploy smoke. A revalidated admin file (304) is no longer answered with `index.html`, which broke the logo after the first load. A request that ends in a 5xx logs its cause; Better Auth server errors carry their response body. A rate-limited sign-in reports a `retryAfter` within the window: Better Auth's pool now reads `bigint` as a number. The default admin theme follows Kumiba: neutral grays, a black primary in light mode and a white one in dark mode, unless the brand sets its own.
