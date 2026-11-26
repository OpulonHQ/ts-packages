# CMS pages and Read API

Editors create a page, set a path and availability per language, add sections, save a draft and publish; the public Read API answers it with Cache-Tags, and publishing purges them from Workers Cache. Collections, menus, site settings and redirects follow the same draft -> publish model.

## Sub-features

- `create` New page opens a picker (`Blank page` plus each host template, with its description and section types) when the host defines templates; the choice creates the page at once and opens `/admin/cms/pages/<id>`. Without templates it creates an empty page in one click.
- `draft` Save draft -> `Draft saved.` (`PUT /api/cms/pages/<id>/draft`).
- `publish` Publish saves the draft, then publishes -> `Published.`; Unpublish -> `Unpublished. The page is no longer on the website.`
- `read-api` `GET /api/cms/resolve?path=<path>` 200, Cache-Tag containing `cms` and `cms:page:<id>`, `public, max-age=0, s-maxage=3600`.
- `redirects` changing a published path adds a redirect.
- `collection-filters` a collection's list offers one filter per field its definition's `filters` names (posts: Categories, Kind); collections without `filters` show only search.
- `list-field` a list field (`Cards` in the Cards section, `Questions` on posts, `Offices` in site settings) shows its items in order, each with `Move item <n> up`, `Move item <n> down`, `Remove item <n>` and a drag grip, and `Add item` below.
- `live-preview` the page editor's three panes (Page outline, Preview, the selection's inputs): the frame (`/site/?preview=<id>&locale=<locale>`, served by the fixture Worker) shows unsaved edits, a click in the frame focuses that field's input, the panes stack at phone width.

## How to get to it (user POV)

- Sidebar `Pages` -> `/admin/cms/pages` -> `New page`, or a row -> `/admin/cms/pages/<id>`.
- Sidebar `Collections`, `Menus` (both with children), `Site settings`, `Redirects`.
- Public: the Read API, as the Nuxt site calls it. Italian paths resolve under `/it/...`.

## Driving it with ui.sh

Preconditions: a session with cms rights (smoke owner).

- **Create, publish, resolve.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-pages.mjs email=<owner> 'password=smoke password <run>'`. Proves: `POST /api/cms/pages` 200; English (the editor's `Content language` switch starts on it) `Path` `/verify-<run>`, the `English` box of `Languages` checked, `SEO title`; draft `PUT` 200 + `Draft saved.`; publish 200 + `Published.`; the Read API answers 200 with the tags; the list row shows the SEO title and `Published`; a second, Italian-only page (`Italian` content language, `Italian` box) lists with its Italian SEO title, `/it/solo-<run>` and only the `IT` chip, and the `Language` filter set to Italian keeps it and drops the English page.
- **Create from a template.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-page-templates.mjs`. Proves: the picker offers `Blank page` and `Landing page` with `Sections: Hero, Stats, Rich text`; picking it sends `POST /api/cms/pages` 200 with three sections and fresh ids; the editor shows the hero title `Welcome`, stats count `120` and the rich text copy; draft and publish answer 200; the Read API serves the template copy.
- **Live preview.** `VERIFY_VIDEO=1 $V/ui.sh .claude/skills/verify-host/journeys/cms-live-preview.mjs`. Proves: three panes side by side at 1440 px; typing the hero title updates the frame while the stored draft keeps the old title; clicking the stats note in the frame focuses `sections.1.note`; Enter on an outline entry selects it; an added Rich text section shows in the frame as typed; Mobile narrows the frame to 390 px; Save stores and Publish serves the edits; at 390 px the panes stack with no horizontal scroll.
- **Resolved preview.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-preview-resolved.mjs`. Seeds an uploaded image, a published link target and a page with a `Cards` section (card A, no link) and a `Hero` holding the image through the API. Proves: `GET .../preview` gives the hero image as `ResolvedMedia`; choosing `URL` on card A's `Links to` and typing a path makes the frame render `<a href>` with it, through the editor's `POST .../preview` (200, hero image resolved); switching to `Page` and the target makes the frame link to the target's public path; the stored draft keeps no link.
- **Hidden section.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-hidden-section.mjs`. Seeds and publishes a page with Hero and Stats through the API. Proves: Stats' `Hide on the site` switch marks its outline entry `Hidden` and the frame keeps Stats with `data-cms-hidden` (dashed outline, `Hidden on the site` label); switching it off removes the marker; Save stores `hidden: true` on Stats only and the page is `changed` while the Read API still serves Stats; after Publish the Read API leaves Stats out; showing and publishing again brings it back with no `hidden` key stored.
- **List field.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-list-field.mjs`. Seeds a published link target and a page with a `Cards` section holding cards A and B through the API. Proves: `Add item` focuses the new item's Title and the frame shows A, B, C while the stored draft keeps two; Enter on `Move item 3 up` gives A, C, B and focus follows the item; dragging item 1's grip onto item 2 gives C, A, B (the journey grows the viewport first: a drop outside it never arrives); `Remove item 3` gives C, A; a click on the list in the frame focuses the first item's Title; Save stores C then A with A's id kept; Publish 200 and the Read API serves C then A with the link inside A resolved and the target's Cache-Tag; an untitled third item makes Publish answer 400 with `"Cards", item 3: "Title" is required in en.`; restoring the first revision through the API brings back A then B with their ids; with `Italian` as the content language, Enter on `Add item` puts focus in the new item's Italian Title, twice, and at four items `Add item` is disabled with focus still in the new item.
- **Purge.** Resolve, edit the SEO title, Publish, resolve again: the new title is served.
- **Concurrent draft edits.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-draft-conflict.mjs`. For a page, an item, the site settings and a menu: the editor opens the document and types, another editor restores revision 1 through the API, the editor's Publish answers `PUT .../draft?version=` 409 with no publish request, the draft and published snapshot stay as the restore left them, the typed input stays on screen under `Someone else changed this draft after you opened it.`, and `Reload draft` loads the restored draft, which then publishes 200. Results in `conflict-results.json`.
- **Collection list filters.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-collection-filters.mjs`. Seeds two categories and three posts through the API; on Posts, Categories = News sends `filter=categories:<id>` 200 and lists the two posts in News, Kind = Guide adds `filter=kind:guide` and lists one, Reset lists all three; `filter=title:x` answers 400 `CmsInvalid`; Categories shows no filter.
- **Picker upload during a save.** `$V/ui.sh .claude/skills/verify-host/journeys/cms-media-pick-during-save.mjs [only=<case>]`. On a post's `Cover`, the picker's `POST /api/media/items` is held, the dialog closed, then `Save draft`, `Publish` (held on its `PUT .../draft`, then on its `POST .../publish`) or `Restore to draft` is held; the upload returns while the action waits. After the action's message the Cover shows the uploaded file, the stored draft has no cover yet, and the next `Save draft` stores it.

## SEO head

`ui.sh journeys/cms-seo.mjs email=... password=...` fills Keywords, Canonical URL and Structured data (JSON-LD) on a new page, shows that a save with the canonical `https://` or a broken JSON-LD answers 400, publishes, sets the X handle in site settings, then calls `buildHead` from `packages/cms/dist` on the Read API answers. It checks the keywords tag, the canonical override, the `twitter:*` tags, and that a `</script>` payload stays inside its `application/ld+json` script when Chrome parses the head. It also publishes a page without the new fields and checks its head has none of the new output. The journey leaves `twitterHandle` set to `example` in this worktree's database.

## Gotchas

- The page editor shows one selection's inputs: click `Page settings` in the `Page outline` before filling Path or SEO fields of a page that has sections (the first section is selected on load).
- A `FieldSelect` trigger is a button named by its label (`getByRole('button', { name: 'Section type' })`), its choices are `option`s.
- Reach the preview with `page.locator('iframe[title="Live preview of the page"]').contentFrame()`.

- There is no Title field: the list shows the en SEO title, else the en path, else `Untitled`.
- Every `Languages` box is off on a new page; without one the Read API does not serve the page in that locale.
- Paths start with `/`, lowercase letters, digits and dashes.
- Assert that Cache-Tag contains the tags, not equality: linked targets add tags and a large set collapses to `cms:routes`.
- `getByRole('button', { name: 'Publish', exact: true })`; Unpublish also matches a substring search.
- Local Workers Cache is workerd's; edge purge timing is covered by `pnpm smoke` against the deployed host.
