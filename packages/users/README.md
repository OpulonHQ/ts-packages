# @opulonjs/users

## Import users from another system

A project that moves onto these packages keeps its users' passwords. `importUsers` from
`@opulonjs/users/server` creates users with the hash their old system stored and the roles you
give them. Sign-in verifies bcrypt hashes (`$2a$`, `$2b$` and `$2y$`, which Laravel writes) next to
this package's own format. The first successful sign-in replaces a bcrypt hash with the current
format, so the old hash is gone from then on.

Call it from a command of a host module. The `opulon` CLI gives the command its database
connection and records each imported user in the audit log under the actor `CLI`:

```ts
// modules/legacy/server.ts
import { defineModule } from '@opulonjs/core'
import { type ImportedUser, importUsers } from '@opulonjs/users/server'
import { Effect } from 'effect'

export const legacy = defineModule({
  id: 'legacy',
  commands: {
    'import-users': {
      description: 'imports users of the old system: --users <JSON array>',
      options: { users: { type: 'string' } },
      run: ({ users }) =>
        typeof users === 'string'
          ? Effect.map(
              importUsers(JSON.parse(users) as ReadonlyArray<ImportedUser>),
              (ids) => `imported ${ids.length} user(s)`,
            )
          : Effect.fail(new Error('--users <JSON> is required')),
    },
  },
})
```

```sh
opulon legacy import-users --server server/opulon.ts --users '[
  { "email": "eva@example.com", "name": "Eva", "passwordHash": "$2y$12$...", "roleIds": ["super_admin"] }
]'
```

Each user needs:

| Field          | Value                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| `email`        | Their address. It is stored lowercased.                                                    |
| `name`         | Their display name.                                                                        |
| `passwordHash` | The stored hash, unchanged: bcrypt, or a `pbkdf2v1:` hash from another host.               |
| `roleIds`      | Ids of roles that exist: `super_admin`, or the `id` of a role from `GET /api/users/roles`. |

Create the roles before the import (Roles screen in the admin). The users are active and count as
verified, and they sign in with the password they already have. `importUsers` grants the roles
you name without an escalation check, so call it only from trusted host code, never from a request
handler.

One call is one transaction. It fails and creates nothing when an address is invalid or already in
use, a role does not exist, or a hash is in a format sign-in cannot verify (argon2 and scrypt are
not supported). The error names the address.

A bcrypt check runs in JavaScript on Workers. A hash with cost 12 takes a few hundred milliseconds
of CPU on the user's first sign-in; later sign-ins use the current format.
