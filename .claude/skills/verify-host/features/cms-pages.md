# CMS pages and Read API

Editors create a page, set a path and availability per language, add sections, save a draft and publish; the public Read API answers it with Cache-Tags, and publishing purges them from Workers Cache. Collections, menus, site settings and redirects follow the same draft -> publish model.

## Sub-features

- `create` New page creates an empty page at once and opens `/admin/cms/pages/<id>` (no form).
- `draft` Save draft -> `Draft saved.` (`PUT /api/cms/pages/<id>/draft`).
- `publish` Publish saves the draft, then publishes -> `Published.`; Unpublish -> `Unpublished. The page is no longer on the website.`
- `read-api` `GET /api/cms/resolve?path=<path>` 200, Cache-Tag containing `cms` and `cms:page:<id>`, `public, max-age=0, s-maxage=3600`.
- `redirects` changing a published path adds a redirect.

## How to get to it (user POV)

- Sidebar `Pages` -> `/admin/cms/pages` -> `New page`, or a row -> `/admin/cms/pages/<id>`.
- Sidebar `Collections`, `Menus` (both with children), `Site settings`, `Redirects`.
- Public: the Read API, as the Nuxt site calls it. Italian paths resolve under `/it/...`.

## Driving it with ui.sh

Preconditions: a session with cms rights (smoke owner).

- **Create, publish, resolve.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-pages.mjs email=<owner> 'password=smoke password <run>'`. Proves: `POST /api/cms/pages` 200; English tab `Path` `/verify-<run>`, `Available in this language` on, `SEO title`; draft `PUT` 200 + `Draft saved.`; publish 200 + `Published.`; the Read API answers 200 with the tags; the list row shows the SEO title and `Published`.
- **Purge.** Resolve, edit the SEO title, Publish, resolve again: the new title is served.

## Gotchas

- There is no Title field: the list shows the en SEO title, else the en path, else `Untitled`.
- `Available in this language` is off by default; without it the Read API does not serve the page.
- Paths start with `/`, lowercase letters, digits and dashes.
- Assert that Cache-Tag contains the tags, not equality: linked targets add tags and a large set collapses to `cms:routes`.
- `getByRole('button', { name: 'Publish', exact: true })`; Unpublish also matches a substring search.
- Local Workers Cache is workerd's; edge purge timing is covered by `pnpm smoke` against the deployed host.
