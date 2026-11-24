# @opulonjs/users

## Protect host routes outside the composed API

A host that already has its own routes (Nitro/h3 handlers, a plain `fetch` route) keeps them and
checks the staff session with `staffAccess` from `@opulonjs/users/server`. It takes a plain
`Request` and returns Promises, so the route needs no Effect code.

```ts
// server/staff.ts
import { staffAccess } from '@opulonjs/users/server'
import { server } from './opulon.ts' // the host's composeServer(...) result

export const staff = staffAccess(server, {
  database: (env: Env) => env.HYPERDRIVE,
})
```

`env` is the Worker env: the Hyperdrive binding `database` picks, plus the `USERS_BASE_URL` and
`USERS_AUTH_SECRET` the users module already needs.

| Call                                      | Resolves with                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `staff.session(request, env)`             | `{ user, setCookies }` for a signed-in, active staff user, else `undefined`   |
| `staff.require(request, env, permission)` | `{ ok: true, user, setCookies }`, or `{ ok: false, response }` to answer with |

`user` holds `id`, `name`, `email`, `locale` and `permissions` (the keys the user holds).
`permission` is a permission key, or `signedIn` for any staff user. A refusal's `response` is what
the composed API answers: 401 with `{"_tag":"Unauthorized"}` without a session and 403 with
`{"_tag":"Forbidden"}` without the permission, both `private, no-store`. A key the composed
catalog does not contain is held by nobody, Super admin included, so it answers 403.

Every call reads the session and the user's roles from Postgres. A deactivated user is signed
out and a removed role is gone on the next request; nothing is cached. The call rejects when
Postgres cannot be reached, so the route fails instead of passing.

Append `setCookies` to your response as `Set-Cookie` headers. It holds the refreshed session
cookie when the session was extended and is empty otherwise; without it the browser's cookie
can expire while the session is still valid.

Pass the request as you received it. The check reads its `Cookie` and `Origin` headers and its
method, and nothing else. A request with another method than GET, HEAD or OPTIONS whose `Origin`
is not the origin of `USERS_BASE_URL` counts as signed out, as on the composed API. Change state
only in handlers of mutating methods.

### Nuxt

In a Nuxt host on Workers, a server route gets the request from `toWebRequest(event)` and the env
from `event.context.cloudflare.env`. h3 sends a returned `Response` as it is.

```ts
// server/routes/shop/orders.get.ts
import { staff } from '../../staff.ts'

export default defineEventHandler(async (event) => {
  const check = await staff.require(
    toWebRequest(event),
    event.context.cloudflare.env,
    'shop.orders.view',
  )
  if (!check.ok) return check.response
  for (const cookie of check.setCookies) appendResponseHeader(event, 'set-cookie', cookie)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return { orders: await listOrders(), viewer: check.user.id }
})
```

With many routes, put the first lines into one server util that returns the user or the refusal.
`fixtures/nuxt/server/routes/shop/orders.get.ts` is this route in the repository's Nuxt fixture.

### Permission keys of host routes

Declare the keys your own routes check when you compose the server. They join the permission
catalog: the Roles screen offers them, roles grant them and Super admin holds them. The host
needs no module and no API group for it.

```ts
// server/permissions.ts
export const hostPermissions = ['shop.orders.view'] as const

// server/opulon.ts
export const server = composeServer({ modules: [...], permissions: hostPermissions })
```

A key is lowercase segments joined by dots, as in `shop.orders.view`. Its first segment must not
be the id of a composed module, since a module declares its own keys. The Roles screen groups
keys under that first segment ("Shop"). Label them in the admin with `createAdmin`'s `messages`:

```ts
// admin/main.ts
import type { Labels } from '@opulonjs/admin'
import type { hostPermissions } from '../server/permissions.ts'

type HostLabels = Labels<(typeof hostPermissions)[number]>

createAdmin({
  brand,
  modules,
  messages: {
    en: { permissions: { 'shop.orders.view': 'View orders' } satisfies HostLabels },
  },
}).mount('#app')
```

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

A bcrypt check runs in JavaScript on Workers. A sign-in against a hash with cost 12 had a response
time of 0.2 to 0.3 seconds, measured on a local workerd; later sign-ins use the current format.
Expect a bcrypt check to need far more than the 10 ms of CPU per request of Workers Free, so
imported bcrypt users need Workers Paid until their first sign-in has upgraded the hash.
