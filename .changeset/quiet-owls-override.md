---
'@opulonjs/admin': minor
---

Allow hosts to replace admin screens by route name using components or lazy loaders, and UI kit components through the Vite preset. Warn when copied source headers precede the installed package version, when a header is malformed, when registered copies or imported files under the Vite root's `overrides/` directories lack a header, or when the package version cannot be checked. These checks run when the preset's `overrides` option is set (`overrides: {}` for screen copies only).

The built-in Dashboard is now a separate lazy chunk for every host, so an overridden Dashboard never downloads the original.

Keep Effect outside dependency prebundling when component overrides are configured.

Show a retryable error above the current screen when the latest navigation fails, because its screen does not load or a global or enter guard throws (a screen's own leave-guard error stays in the console), and re-check the server build so a deploy prompts a reload. Try again opens the failed address with a fresh page load; when only its `#fragment` differs from the current address, the browser re-runs the navigation in the page instead.
