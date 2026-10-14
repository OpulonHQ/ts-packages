import { Effect } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientError } from 'effect/http/HttpClientError'
import * as HttpApi from 'effect/http-api/HttpApi'
import * as HttpApiClient from 'effect/http-api/HttpApiClient'
import type * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { inject } from 'vue'
import { apiContextKey } from './state.ts'

/** The typed client of one HttpApi group: endpoint identifiers to client methods. */
export type GroupClient<Group extends HttpApiGroup.Constraint> = HttpApiClient.Client.Group<
  Group,
  HttpClientError,
  never
>

/**
 * The typed client of a module's own HttpApi group, for module screens. The group mounts where
 * composition puts it: `<apiPrefix>/<module id>`, the module id being the group identifier's
 * first segment. Core mounts at `<apiPrefix>` itself. Returns a runner: `const demo = useApiClient(DemoGroup)` in `setup`, then
 * `await demo((client) => client.notes())`.
 */
export const useApiClient = <Group extends HttpApiGroup.Constraint>(group: Group) => {
  const context = inject(apiContextKey)
  if (!context) throw new Error('useApiClient must be called inside a createAdmin app')
  const { apiPrefix, fetch } = context
  const moduleId = group.identifier.split('.')[0]
  const api = HttpApi.make('opulon')
    .add(group as unknown as HttpApiGroup.Top)
    .prefix((moduleId === 'core' ? apiPrefix : `${apiPrefix}/${moduleId}`) as `/${string}`)
  // Safe: `api` holds exactly `group` (prefixed), and module groups need no client middleware
  // (core's Authorization is server-only), so only the generic types are erased here.
  const client = Effect.flatMap(HttpClient.HttpClient, (httpClient) =>
    HttpApiClient.group(api, { group: group.identifier, httpClient, baseUrl: location.origin }),
  ) as unknown as Effect.Effect<GroupClient<Group>, never, HttpClient.HttpClient>

  return <A, E>(run: (client: GroupClient<Group>) => Effect.Effect<A, E>): Promise<A> =>
    Effect.runPromise(
      client.pipe(
        Effect.flatMap(run),
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    )
}
