import { Users } from '@opulonjs/users/server'
import type { Effect } from 'effect'
import { expectTypeOf } from 'vitest'

declare const users: (typeof Users)['Service']
declare const headers: Headers

expectTypeOf(users.requestPasswordReset(headers, 'eva@example.test')).toExtend<
  Effect.Effect<void, unknown>
>()
expectTypeOf(users.requestPasswordReset(headers, 'eva@example.test', 'a-token')).toExtend<
  Effect.Effect<void, unknown>
>()
