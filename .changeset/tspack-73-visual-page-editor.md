---
'@opulonjs/cms': minor
'@opulonjs/ui': minor
---

Edit pages in three panes: the page settings and the ordered section list on the left (select, add, move, remove), a live preview of the unsaved draft in the middle, and the inputs of the selected section or the page settings on the right. Narrow screens stack the panes. Pass `cmsAdmin({ preview: { url } })` to show the host site's page in the preview frame; without it the editor has two panes. Clicking a section in the preview selects it and focuses its input (the input of the field a `data-cms-field` element names) in the language the preview shows. `@opulonjs/cms/site` exports `useCmsLivePreview(initial, { adminOrigin })`, which renders the draft the admin posts and reports clicks; it accepts messages only from `adminOrigin`, only inside a frame on a `?preview` page, and does nothing without an origin; when the URL loses `?preview` or a reactive `adminOrigin` goes away, it drops the draft and stops. In live mode `CmsSections` marks each section root with `data-cms-section`. The admin builds the preview with the same code as `GET /pages/:id/preview`, rich text sanitized as on save, so nothing is saved until Save or Publish.

`LocaleTabs` takes an optional `v-model` with the locale whose tab is shown.
