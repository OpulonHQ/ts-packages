---
'@opulonjs/cms': patch
'@opulonjs/users': patch
'@opulonjs/emails': patch
---

Review fixes, round 2. cms: SSR drops credentials passed to the in-process cms fetch outside `?preview`, and HTML that read any non-public cms answer is `private, no-store` without Cache-Tag; `resolve` answers non-site paths (encoded `//`, backslashes, control characters) as not found and redirects to canonical paths in one hop, never off the site; in the default locale, redirect paths drop its own prefix and a `from` under another locale's prefix is refused, so a redirect cannot loop through resolve's prefix redirect; the sitemap index links children at `<apiPrefix>/cms/sitemaps/<file>`, and routed collections' sources are `cms.items.<key>`; Cache-Tag headers stay under 8 KiB by collapsing page and item tags into `cms:routes` (also for SSR HTML); a Cloudflare purge's deadline covers its body. users: accepting an invitation takes the users/roles lock first, so it cannot deadlock with a re-invite. emails: every delivery attempt ends at a deadline inside its lease, and Resend's timeout covers the response body.
