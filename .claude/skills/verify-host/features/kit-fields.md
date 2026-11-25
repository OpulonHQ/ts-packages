# UI kit fields and table

What it proves: on the demo module's Kit fields screen (`/admin/demo/kit`) the date, date-time, money, file and relation fields edit their values, refuse bad input with a message (a malformed amount keeps the last amount and blocks Save), raise and clear the Unsaved changes bar, show the form's error and can be disabled; the relation field searches `GET /api/demo/notes/search` by keyboard without a request per keystroke, offers no option of the previous term, and clears by its Clear button; the table filters by a date range, turns reorder off while it does, and reorders by keyboard and by drag.

## Run

1. Baseline preconditions from [README.md](README.md). Any user with `demo.notes.view` works; the seeded note `hello from demo` must exist.
2. `EVIDENCE_DIR=.verify/kit $V/ui.sh .claude/skills/verify-host/journeys/kit-fields.mjs` from the repository root.
3. Expect every `check` line to pass, with screenshots of the empty form, the refused amount and file, the relation list with and without a match, the required-day error, the filled and the locked form, the date-range filter, both reorders and the dark theme.

## Gotchas

- The screen keeps nothing on the server: a reload starts from the empty form and the original row order.
