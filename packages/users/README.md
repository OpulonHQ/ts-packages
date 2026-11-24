# @opulonjs/users

## Import users from another system

A project that moves onto these packages keeps its users' passwords. `importUsers` from
`@opulonjs/users/server` creates users with the hash their old system stored and the roles you
give them. Sign-in verifies bcrypt hashes (`$2a$`, `$2b$` and `$2y$`, which Laravel writes) next to
this package's own format. The first successful sign-in replaces a bcrypt hash with the current
format, so the old hash is gone from then on.

Call it from a command of a host module. The `opulon` CLI gives the command its database
connection and records each imported user in the audit log under the actor `CLI`. Read the batch
from a file, never from a command-line argument: arguments show up in the process list and stay in
the shell history, and the batch holds password hashes.

```ts
// modules/legacy/server.ts
import { readFile } from 'node:fs/promises'
import { defineModule } from '@opulonjs/core'
import { importUsers } from '@opulonjs/users/server'
import { Effect } from 'effect'

export const legacy = defineModule({
  id: 'legacy',
  commands: {
    'import-users': {
      description: 'imports users of the old system: --file <JSON array>',
      options: { file: { type: 'string' } },
      run: ({ file }) =>
        typeof file === 'string'
          ? Effect.tryPromise(() => readFile(file, 'utf8')).pipe(
              Effect.flatMap((text) => importUsers(JSON.parse(text))),
              Effect.map((ids) => `imported ${ids.length} user(s)`),
            )
          : Effect.fail(new Error('--file <path> is required')),
    },
  },
})
```

```json
[
  {
    "email": "eva@example.com",
    "name": "Eva",
    "passwordHash": "$2y$12$...",
    "roleIds": ["super_admin"]
  }
]
```

```sh
opulon legacy import-users --server server/opulon.ts --file users.json
```

Delete the file afterwards. The other way is a host script that reads the old database and calls
`importUsers` with the rows directly, so the hashes never touch a file.

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

`importUsers` checks every row itself, so parsed JSON can go in as it is. One call is one
transaction. It fails and creates nothing when a row is malformed (a missing `roleIds`, for
example), an address is one sign-in would not accept or is already in use, a role does not exist,
or a hash is in a format sign-in cannot verify (argon2 and scrypt are not supported). The error
names the row, as in `user 3 (eva@example.com): unknown role editors`. Sign-in accepts ASCII
domains only, so an address with a non-ASCII domain or a punycode top-level domain is refused.

A bcrypt check runs in JavaScript on Workers. A hash with cost 12 took 0.2 to 0.3 seconds of CPU
on a local workerd; later sign-ins use the current format. That is far more than the 10 ms of CPU
per request of Workers Free, so imported bcrypt users need Workers Paid until their first sign-in
has upgraded the hash.
