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

| Call                                      | Resolves with                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `staff.session(request, env)`             | `{ user, passwordConfirmed, setCookies }` for a signed-in, active staff user, else `undefined` |
| `staff.require(request, env, permission)` | `{ ok: true, user, setCookies }`, or `{ ok: false, response }` to answer with                  |

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

## Manage staff

| Action                       | Endpoint under `<apiPrefix>/users` | Needs                | Audit event                |
| ---------------------------- | ---------------------------------- | -------------------- | -------------------------- |
| Edit a user's name and email | `PUT /users/:id`                   | `users.manage`       | `users.updated`            |
| List open invitations        | `GET /invitations`                 | `users.manage`       |                            |
| Send an invitation again     | `POST /invitations/:id/resend`     | `users.manage`       | `users.invited`            |
| Revoke an invitation         | `DELETE /invitations/:id`          | `users.manage`       | `users.invitation_revoked` |
| Delete a role                | `DELETE /roles/:id`                | `users.roles.manage` | `users.role_deleted`       |
| Change the own password      | `PUT /password`                    | a session            | `users.password_changed`   |

A changed email must be free (409 otherwise) and one sign-in accepts (400 otherwise). It ends that
user's sessions and cancels the password reset links already sent to the old address; the old
address gets no notice. An invitation sent
again keeps its roles and gets a new link; the old link stops working. A manager cannot send again
or revoke an invitation that grants a role they may not grant. A role is deleted only when no
user holds it, deactivated users included (409 otherwise); Super admin is never deleted.

`PUT /password` takes `{ "currentPassword": "...", "newPassword": "..." }`. It ends the user's
other sessions and keeps the one that sent it. It needs no password confirmation: the current
password is the proof. A wrong one answers 403 `WrongPassword`, counts against the same 5 attempts
a minute per client address as a confirmation and writes `users.password_confirmation_failed`.

## Ask for the password again before a sensitive action

Mark an endpoint `Sensitive` and a signed-in staff user must have entered their password
shortly before it runs. Without a recent confirmation the endpoint answers 403 with
`{"_tag":"PasswordConfirmationRequired"}`, after the session and permission checks.

```ts
import { Authorization, Policy, Sensitive } from '@opulonjs/core/api'

export const ShopGroup = HttpApiGroup.make('shop')
  .add(
    HttpApiEndpoint.post('refund', '/refunds', { payload: Refund })
      .annotate(Policy, 'shop.orders.refund')
      .annotate(Sensitive, true),
  )
  .middleware(Authorization)
```

A screen calls the endpoint through `useApiClient` and adds nothing. On that answer the admin
shell opens one password dialog, confirms the session and sends the request once more; the screen
gets the final answer. When the user cancels the dialog or the route changes (path, params or
query), nothing is sent again and the call fails with `PasswordConfirmationRequired`. A request
the admin sends another way (its own `fetch`) is not repeated.

`POST <apiPrefix>/users/password-confirmation` with `{ "password": "..." }` confirms the session
that sent it: 204, 403 `{"_tag":"WrongPassword"}`, or 429 `{"_tag":"TooManyRequests"}` after 5
attempts a minute from one client address. The address is the one sign-in limits by: an IPv6
address counts as its /64. A wrong password writes the audit event
`users.password_confirmation_failed`. A confirmation belongs to that one session: another browser,
a new sign-in and a password reset start unconfirmed. Signing in is not a confirmation.

A confirmation lasts 5 minutes. Set `USERS_PASSWORD_CONFIRM_WINDOW` in the Worker env to change
it for the whole host, for example `10 minutes`.

A host route outside the composed API makes the same check with `staffAccess`:

```ts
const check = await staff.require(request, env, 'shop.orders.refund', { sensitive: true })
if (!check.ok) return check.response
```

The admin's dialog does not cover such a route: `useApiClient` only calls groups under the API
prefix. A host screen that calls a route outside it handles the 403 itself: ask for the password,
confirm with the endpoint above, then send the request again. `staff.session` also returns
`passwordConfirmed`.

Core's `authorization(authenticate)` takes a lookup that returns `{ user, passwordConfirmed }`. A
lookup that returns only the user, as before, never passes a `Sensitive` endpoint.

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

## Guard sign-in with Cloudflare Turnstile

Off by default. To turn it on, set three Worker env values and pass the widget's site key to the
admin:

| Env                         | Value                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| `USERS_TURNSTILE`           | `true`                                                                 |
| `USERS_TURNSTILE_SECRET`    | the widget's secret key (`wrangler secret put`)                        |
| `USERS_TURNSTILE_HOSTNAMES` | the hostnames the admin is served from, comma-separated: `example.com` |

```ts
usersAdmin({ turnstile: { siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY } })
```

The sign-in and forgotten-password screens then show the widget, and the server refuses a sign-in
or password-reset request with 403 `{"_tag":"TurnstileFailed"}` unless its `turnstileToken` passes
siteverify for the action (`sign-in`, `request-password-reset`) and one of the hostnames. The check
runs before the user is looked up, so a refused request costs no password hash and no sign-in
attempt. A siteverify that fails or does not answer within 5 seconds refuses the request.
Invitation acceptance and the reset link itself are not guarded.

The Worker switch and the admin's site key are set separately, and both sides must agree. Each
of these answers 403 `{"_tag":"TurnstileNotConfigured"}` or shows "The check that you are human is
not set up correctly", and the Worker logs the first two:

- `USERS_TURNSTILE` on without a secret or hostname list: every request is refused.
- A site key in the admin with `USERS_TURNSTILE` off: a request that carries a token is refused. A
  request without a token works as it does with no Turnstile at all.
- `USERS_TURNSTILE` on and no site key in the admin: the screens have no widget and every sign-in
  is refused.

How `USERS_TURNSTILE` is read (text is lowercase, exactly as written here):

| Value                                                                           | The check                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------- |
| boolean `true`, `true`, `yes`, `on`, `1`                                        | on                                          |
| not set, an empty value, boolean `false`, `false`, `no`, `off`, `0`             | off                                         |
| any other text or number (`TRUE`, `enabled`, `2`)                               | every sign-in and reset request answers 500 |
| a JSON object, array or `null` (ignored like a binding, so it reads as not set) | off                                         |

An admin built with a site key against a Worker whose switch is off refuses every sign-in with
the "not set up correctly" message. That is how a switch left empty by mistake shows up.

When Cloudflare's script does not load, for example behind a content blocker, the screens say so
and offer "Try again".

For local development use Cloudflare's dummy keys: site key `1x00000000000000000000AA` with secret
`1x0000000000000000000000000000000AA` always passes, secret `2x0000000000000000000000000000000AA`
always fails. A dummy secret answers hostname `example.com` and no action, so those two
comparisons are skipped for it; `USERS_TURNSTILE_HOSTNAMES` must still be set.

### The same check on a host form

```ts
import { verifyTurnstile } from '@opulonjs/core/turnstile'

const check = await verifyTurnstile({
  secret: env.TURNSTILE_SECRET,
  hostnames: ['example.com'],
  action: 'contact',
  token: body.turnstileToken,
  remoteIp: request.headers.get('cf-connecting-ip') ?? undefined,
})
if (!check.ok) return new Response(null, { status: 403 })
```

It never throws and refuses on every failure; `check.reason` is for the server log. The entry
imports neither Effect nor the users module. The widget for the form is a Vue component:

```vue
<script setup lang="ts">
import Turnstile from '@opulonjs/ui/components/Turnstile'
import { ref, useTemplateRef } from 'vue'

const token = ref<string>()
const widget = useTemplateRef('widget')
</script>

<template>
  <Turnstile ref="widget" v-model="token" site-key="1x00000000000000000000AA" action="contact" />
</template>
```

`token` is undefined until the visitor passes and again when the token expires. A token passes
the server once: call `widget.reset()` after every post that used it. When Cloudflare's script
does not load, the component renders its `unavailable` slot; the slot's `retry` loads it again:

```vue
<Turnstile v-model="token" site-key="..." action="contact">
  <template #unavailable="{ retry }">
    <p role="alert">The check did not load.</p>
    <button type="button" @click="retry">Try again</button>
  </template>
</Turnstile>
```
