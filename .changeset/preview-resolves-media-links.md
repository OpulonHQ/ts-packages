---
'@opulonjs/cms': patch
---

A page preview now gives section components the shape the Read API gives them. `GET /pages/:id/preview` and the admin's live preview resolve media fields to `ResolvedMedia` (null when gone) and link fields to `ResolvedLink` with `href`, at the top level and inside list items, through the Read API's resolver. Before, the preview held media ids and links without `href`, so a component typed with `SectionData` broke or showed raw values there. Sections of a type the host removed are left out, as on the public page.

The live preview sends the unsaved draft to the new `POST /pages/:id/preview` (permission `cms.pages.view`), which renders it as the GET renders the saved draft, and posts the answer to the frame. When that request fails, the pane says so and the frame keeps the last draft it got.
