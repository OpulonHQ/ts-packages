---
'@opulonjs/core': patch
---

`serveAdmin` answers a missing hashed `/admin/assets/*` file with `no-store`, so a request that races a deploy (new `index.html`, assets not yet everywhere) is not kept as a 404 by Workers Cache or the CDN.
