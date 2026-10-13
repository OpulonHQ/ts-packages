# Media library

Editors upload images and files, edit their details, replace a file (pages using it pick up the new version), and pick media from content editors. Originals are served immutable from R2 under `/media/**`.

## Sub-features

- `upload` Upload on `/admin/media`.
- `details` Media details: alt text etc., Save -> `Saved.`
- `replace` replace the file -> `File replaced. Pages using this item now show the new version.`
- `serve` `GET /media/...` 200 with `public, max-age=31536000, immutable`.

## How to get to it (user POV)

- Sidebar `Media` -> `/admin/media`; an item opens Media details.
- From a cms field, Choose media.

## Driving it with ui.sh

Preconditions: signed-in user with `media.upload`.

- **Upload.** On `/admin/media` click `Upload` and `page.setInputFiles` on the file input with a PNG. Expect the item in the grid and `POST /api/media/items` 200.
- **Serve.** Open the item's URL: 200, `image/png`, immutable Cache-Control (the smoke checks this).
- **Second view.** The object exists in local R2 (`fixtures/host/.wrangler/verify`) and as a row in `tspack_verify`; the audit trail records `Media uploaded`.

## Gotchas

- Resized URLs (`/cdn-cgi/image/...`) need Image Transformations and do not work locally; verify originals only.
- The fixture's widths are 320/640/1280 (`fixtures/host/server/opulon.ts`).
- Not yet driven through the UI by a journey.
