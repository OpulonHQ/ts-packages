---
'@opulonjs/cms': patch
---

Split sitemap sources into children of at most 10 MB of uncompressed UTF-8 XML and 50,000 URLs to reduce buffered response memory in Workers.
