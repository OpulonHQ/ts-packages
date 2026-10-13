# Media library

Editors upload images and PDFs, edit alt text and caption per content language (en, it), replace a file (pages using it show the new version), and archive or restore items. Originals are served immutable from R2 at `/media/<id>/<version>/<filename>`.

## Sub-features

- `upload` Upload on `/admin/media`; the Media details dialog opens on its own.
- `details` Alt text etc. -> Save -> `Saved.` (`PATCH /api/media/items/<id>`).
- `replace` replace the file -> `File replaced. Pages using this item now show the new version.`
- `serve` `GET /media/<id>/<version>/<filename>` 200 with `public, max-age=31536000, immutable`.

## How to get to it (user POV)

- Sidebar `Media` -> `/admin/media` (a table captioned `Media library`); a row opens Media details.
- From a cms field (e.g. Social image), `Choose media`.

## Driving it with ui.sh

Preconditions: a session with `media.upload` (smoke owner).

- **Upload, alt, serve.** `$V/ui.sh .claude/skills/verify-host/journeys/media.mjs email=<owner> 'password=smoke password <run>'`. Proves: `POST /api/media/items` 200; dialog `Media details`; alt text saved (`PATCH` 200, `role=status` `Saved.`); the `Open original` link answers 200 `image/png` immutable; the file's row in the library.
- **Second view.** The row in the verify database (`source $V/env.sh && psql "$db_url"`); the object in local R2 under `fixtures/host/.wrangler/verify`.

## Gotchas

- The file input is hidden (`sr-only`) and labelled `Upload`: use `getByLabel('Upload', { exact: true }).setInputFiles(...)`, not a click on the button.
- Alt text and caption exist per locale tab and both tabs are mounted: use `getByRole('textbox', { name: 'Alt text' })` inside the dialog, not `getByLabel`.
- Resized URLs (`/cdn-cgi/image/...`) need Image Transformations and do not work locally; verify originals only. The fixture's widths are 320/640/1280.
