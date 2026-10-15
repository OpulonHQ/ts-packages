# CMS pages and Read API

Editors create a page, set a path and availability per language, add sections, save a draft and publish; the public Read API answers it with Cache-Tags, and publishing purges them from Workers Cache. Collections, menus, site settings and redirects follow the same draft -> publish model.

## Sub-features

- `create` New page opens a picker (`Blank page` plus each host template, with its description and section types) when the host defines templates; the choice creates the page at once and opens `/admin/cms/pages/<id>`. Without templates it creates an empty page in one click.
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
- **Create from a template.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-page-templates.mjs`. Proves: the picker offers `Blank page` and `Landing page` with `Sections: Hero, Stats, Rich text`; picking it sends `POST /api/cms/pages` 200 with three sections and fresh ids; the editor shows the hero title `Welcome`, stats count `120` and the rich text copy; draft and publish answer 200; the Read API serves the template copy.
- **Purge.** Resolve, edit the SEO title, Publish, resolve again: the new title is served.
- **Concurrent draft edits.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-draft-conflict.mjs`. For a page, an item, the site settings and a menu: the editor opens the document and types, another editor restores revision 1 through the API, the editor's Publish answers `PUT .../draft?version=` 409 with no publish request, the draft and published snapshot stay as the restore left them, the typed input stays on screen under `Someone else changed this draft after you opened it.`, and `Reload draft` loads the restored draft, which then publishes 200. Results in `conflict-results.json`.
- **Picker upload during a save.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-media-pick-during-save.mjs [only=<case>]`. On a post's `Cover`, the picker's `POST /api/media/items` is held, the dialog closed, then `Save draft`, `Publish` (held on its `PUT .../draft`, then on its `POST .../publish`) or `Restore to draft` is held; the upload returns while the action waits. After the action's message the Cover shows the uploaded file, the stored draft has no cover yet, and the next `Save draft` stores it.

## Gotchas

- There is no Title field: the list shows the en SEO title, else the en path, else `Untitled`.
- `Available in this language` is off by default; without it the Read API does not serve the page.
- Paths start with `/`, lowercase letters, digits and dashes.
- Assert that Cache-Tag contains the tags, not equality: linked targets add tags and a large set collapses to `cms:routes`.
- `getByRole('button', { name: 'Publish', exact: true })`; Unpublish also matches a substring search.
- Local Workers Cache is workerd's; edge purge timing is covered by `pnpm smoke` against the deployed host.
