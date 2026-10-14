# Server-side list paging and reference picker

What it proves: the users list, the collection items list and the reference picker page, sort and search on the server with more rows than one page; ID filters are bounded; a stale picker search loses; saved, deleted and missing references show correctly.

## Run

1. Baseline preconditions from [README.md](README.md), and `VERIFY_DATABASE_URL` from `env.sh` (the journey reads invitation mail from the database and creates its seed rows only once, recorded in `.verify/paging-data.json`).
2. `EVIDENCE_DIR=.verify/paging $V/ui.sh journeys/list-paging.mjs`
3. Expect every `check` line to pass in `ui.log`, with screenshots of users pages one and two, item title sorting, the picker search and selection (desktop and phone), the single link beyond page one and the missing reference.

The journey removes its temporary invitation-mail trigger when it ends.
