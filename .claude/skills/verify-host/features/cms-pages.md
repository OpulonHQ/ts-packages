# CMS pages and Read API

Editors create a page, edit the draft, publish it, and the public Read API answers it with Cache-Tags; publishing purges those tags from Workers Cache. Collections, menus, site settings and redirects follow the same draft -> publish model.

## Sub-features

- `create` New page on `/admin/cms/pages`.
- `draft` Save draft -> `Draft saved.`; status `Draft` / `Unpublished changes`.
- `publish` Publish -> `Published.`; Unpublish -> `Unpublished. The page is no longer on the website.`
- `read-api` `GET /api/cms/resolve?path=<path>` 200, `Cache-Tag: cms,cms:page:<id>`, `public, max-age=0, s-maxage=3600`.
- `purge` a publish changes what the Read API answers next (cache purged).
- `redirects` changing a published path adds a redirect.

## How to get to it (user POV)

- Sidebar `Pages` -> `/admin/cms/pages` -> `New page` or a row -> `/admin/cms/pages/:id`.
- Sidebar `Collections`, `Menus`, `Site settings`, `Redirects`.
- Public: the Read API, as the Nuxt site calls it.

## Driving it with ui.sh

Preconditions: signed-in user with cms permissions; locales `en`, `it`.

- **Create and publish.** `New page`, fill title and path, `Save draft` (`Draft saved.`), `Publish` (`Published.`). Columns on the list: Title, Path, Status, Edited.
- **Read API.** `curl -i "http://127.0.0.1:<port>/api/cms/resolve?path=<path>"`: 200 with the Cache-Tag above (smoke step `Read API resolve with Cache-Tag`).
- **Purge.** Resolve once, edit and publish again, resolve again: the new content is served (not the cached answer).

## Gotchas

- `cache.enabled` local behaviour is workerd's, not the edge's; purge timing on real Workers is covered by `pnpm smoke` against the deployed host.
- The fixture's definitions live in `fixtures/host/cms/definitions.ts`; required fields there decide what the New page form needs.
- Not yet driven through the UI by a journey.
