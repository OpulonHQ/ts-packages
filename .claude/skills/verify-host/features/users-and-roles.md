# Users and roles

A Super admin creates roles from permissions, invites users with roles, edits a user's roles, and deactivates users. Permissions decide which sidebar items and actions a user sees.

## Sub-features

- `roles` New role -> Name + permission checkboxes -> Save -> `The role is saved.`
- `invite` Invite (toggles an inline form) -> Email + role checkboxes -> Send the invitation -> `The invitation to <email> is on its way.` and a `users.invitation` email.
- `invite-taken` inviting an existing user's email -> `A user with this email already exists.`
- `user-roles` on `/admin/users/:id`, Save roles -> `The roles are saved.`; deactivation there too.
- `account` `/admin/account` (page title My account): name, password, admin language.

## How to get to it (user POV)

- Sidebar `Users` -> `/admin/users`; a row -> `/admin/users/:id`. Pending invitees are not listed as users.
- Sidebar `Roles` -> `/admin/roles`.
- Sidebar footer button `User menu` -> `Account settings` -> `/admin/account`.

## Driving it with ui.sh

Preconditions: a Super admin session (smoke owner).

- **Role + invite + taken + email.** `$V/ui.sh .claude/skills/verify-host/journeys/users-and-roles.mjs email=<owner> 'password=smoke password <run>'`. Proves: `POST /api/users/roles` 200 and `role=status` `The role is saved.`; invite with that role `POST /api/users/invitations` 200 and the status text; inviting the owner's email shows the `role=alert` taken message; the Email log screen lists the invitee and `/api/emails/log` has a `users.invitation` row, status `sent`.
- **Restricted role.** Needs a second signed-in account, which needs an accept link (see sign-in Gotchas): not drivable on a host with a Super admin unless the invitation is bootstrapped from the CLI on a fresh database.

## Gotchas

- Messages are inline `role=status` / `role=alert` paragraphs, not toasts.
- `getByLabel('Name')` / `getByLabel('Email')` also match the table's `Sort by Name` / `Sort by Email` buttons; use `getByRole('textbox', { name: ... })`.
- `Invite` toggles the inline form and it stays open after sending; clicking `Invite` again closes it.
- Permission checkboxes are named by their label, e.g. `Invite and manage users`; role checkboxes in the invite form are named by role name.
