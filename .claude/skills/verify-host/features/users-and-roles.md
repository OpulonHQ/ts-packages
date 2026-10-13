# Users and roles

A Super admin invites users with roles, edits a user's roles, deactivates users, and defines roles from permissions. Permissions decide which sidebar items and actions a user sees.

## Sub-features

- `invite` Invite -> email + roles -> Send the invitation; the invitee gets an email.
- `user-roles` on a user, Save roles changes their permissions.
- `roles` New role / Save on `/admin/roles`.
- `account` My account: name, password, admin language.

## How to get to it (user POV)

- Sidebar `Users` -> `/admin/users`; a row -> `/admin/users/:id`.
- Sidebar `Roles` -> `/admin/roles`.
- User menu (bottom of sidebar) -> My account `/admin/account`.

## Driving it with ui.sh

Preconditions: signed-in Super admin (smoke owner).

- **Invite.** On `/admin/users` click `Invite`, fill `Email`, pick roles, click `Send the invitation`. Expect the toast `The invitation to <email> is on its way.`, a `POST /api/users/invitations` 200, and a new row in the Email log (`emails.md`).
- **Duplicate.** Invite an existing email: expect `A user with this email already exists.`
- **Roles.** On `/admin/roles` click `New role`, name it, tick permissions, `Save`; expect `The role is saved.` Assign it on a user with `Save roles` (`The roles are saved.`), then sign in as that user and check the sidebar shows only what the permissions allow.
- **API second view.** `GET /api/me` lists the signed-in user's permissions (the smoke expects all 20 for a Super admin).

## Gotchas

- Not yet driven through the UI by a journey; write `journeys/invite.mjs` on first use and update the README.
- Testing a restricted role needs a second account: invite it, take the accept link from the email log, accept in a fresh journey.
