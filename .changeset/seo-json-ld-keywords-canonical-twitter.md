---
'@opulonjs/cms': minor
---

Page and routed-item SEO has three optional fields per content locale: keywords, a canonical URL (an http(s) URL or a site path) and JSON-LD structured data, checked as JSON on save. They draft, publish and keep revisions like the other SEO fields, and the Read API returns them in `seo`. `buildHead` writes a `keywords` meta tag, uses the canonical override for the canonical link and `og:url`, and returns the JSON-LD as `script` entries of type `application/ld+json`, escaped so the content cannot close its script tag. A host adds its own structured data with the `jsonLd` option of `buildHead`. When the site settings hold an X (Twitter) handle, `buildHead` adds `twitter:card`, `twitter:site`, `twitter:title`, `twitter:description` and `twitter:image`. A page that sets none of the new fields, on a site without a handle, gets the same head as before.
