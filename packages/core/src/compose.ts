import { Context, Layer, Option } from 'effect'
import type * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpApi from 'effect/http-api/HttpApi'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import type * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { Authorization, Policy, Public } from './authz.ts'
import { apiId, type Module } from './module.ts'

export class CompositionError extends Error {
  override name = 'CompositionError'
}

/** What composition knows about the server, for `/me` and the audit catalog. */
export const Composed = Context.Reference<{
  readonly modules: ReadonlyArray<string>
  readonly permissions: ReadonlyArray<string>
  readonly auditActions: ReadonlySet<string>
}>('@opulonjs/core/Composed', {
  defaultValue: () => ({ modules: [], permissions: [], auditActions: new Set() }),
})

/**
 * The host's content locales (the languages public content is published in), first = default.
 * Set once through `composeServer({ contentLocales })`; modules with localized content (media
 * alt text, cms fields) read it here, and the admin reads it from `/me`.
 */
export const ContentLocales = Context.Reference<ReadonlyArray<string>>(
  '@opulonjs/core/ContentLocales',
  { defaultValue: () => ['en'] },
)

/** The build id createWorker reports in `/me`. */
export const BuildId = Context.Reference<string>('@opulonjs/core/BuildId', {
  defaultValue: () => 'dev',
})

type Provides<M> = M extends Module<string, infer P, unknown, unknown> ? P : never
type Requires<M> = M extends Module<string, unknown, infer R, unknown> ? R : never
// Handlers declare request-time needs as HttpRouter request markers; unwrap them to services.
type HandlerRequires<M> =
  M extends Module<string, unknown, unknown, infer R>
    ? HttpRouter.Request.Without<R> | HttpRouter.Request.Only<'Requires', R>
    : never

// Mirrors the runtime provideMerge chain: a module's layer sees only modules listed before it.
type LayerFold<Ms, Provided = never, Required = never> = Ms extends readonly [infer H, ...infer T]
  ? LayerFold<T, Provided | Provides<H>, Required | Exclude<Requires<H>, Provided>>
  : Required

/**
 * Services the host infra must provide: what a module's layer needs from modules not listed
 * before it, plus what handlers need that no module provides.
 */
export type Unprovided<Ms extends ReadonlyArray<Module>> =
  LayerFold<Ms> | Exclude<HandlerRequires<Ms[number]>, Provides<Ms[number]>>

/** The composed server. `R` is what the host's infra must still provide. */
export interface ComposedServer<R = unknown> {
  /** In topological order (dependencies first, ties by list order). */
  readonly modules: ReadonlyArray<Module>
  readonly apiPrefix: string
  readonly api: HttpApi.Top
  /** The routed API with every module's handlers and layer; still needs `R` (host infra). */
  readonly layer: Layer.Layer<never, unknown, unknown>
  /** Every module's layer, merged; what scheduled tasks run against. Still needs `R`. */
  readonly services: Layer.Layer<never, unknown, unknown>
  readonly '~requires'?: R
}

const idPattern = /^[a-z][a-z0-9_]*$/
const localePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/**
 * Composes modules into one server: checks ids, dependencies, key prefixes and endpoint auth
 * (throwing CompositionError at startup), then wires each module's layer with provideMerge in
 * dependency order, so every module sees everything upstream plus the host infra.
 */
export const composeServer = <const Ms extends ReadonlyArray<Module>>(options: {
  readonly modules: Ms
  /** Where the API is mounted; groups live under `<apiPrefix>/<module id>`. Default `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Content locales (e.g. `['en', 'it']`), the first is the default. Default `['en']`. */
  readonly contentLocales?: ReadonlyArray<string>
}): ComposedServer<Unprovided<Ms>> => {
  const apiPrefix = options.apiPrefix ?? '/api'
  const contentLocales = options.contentLocales ?? ['en']
  const modules = sortModules(options.modules)
  const errors: Array<string> = []

  if (contentLocales.length === 0) errors.push('contentLocales must list at least one locale')
  for (const locale of contentLocales)
    if (!localePattern.test(locale))
      errors.push(`content locale "${locale}" must be a language tag like "en" or "pt-BR"`)
  if (new Set(contentLocales).size !== contentLocales.length)
    errors.push('contentLocales lists a locale twice')

  for (const m of modules) {
    const inPrefix = (key: string) => key === m.id || key.startsWith(`${m.id}.`)
    for (const g of m.groups)
      if (!inPrefix(g.identifier))
        errors.push(`${m.id}: API group "${g.identifier}" is outside the module prefix`)
    for (const key of m.permissions)
      if (!inPrefix(key)) errors.push(`${m.id}: permission "${key}" is outside the module prefix`)
    for (const { key } of m.auditActions)
      if (!inPrefix(key)) errors.push(`${m.id}: audit action "${key}" is outside the module prefix`)
    const tasks = new Set<string>()
    for (const { name } of m.tasks) {
      if (tasks.has(name)) errors.push(`${m.id}: duplicate task name "${name}"`)
      tasks.add(name)
    }
  }

  const auditActions = new Set(modules.flatMap((m) => m.auditActions.map((a) => a.key)))
  if (auditActions.size > 0 && !modules.some((m) => m.id === 'core'))
    errors.push('modules declare audit actions, but core() is not composed (it owns the audit log)')

  // Core is the framework itself: its group (`/me`) sits at the API prefix, not under `/core`.
  const api = makeApi(
    modules.flatMap((m) =>
      m.groups.map((g) => prefixGroup(g, m.id === 'core' ? apiPrefix : `${apiPrefix}/${m.id}`)),
    ),
  )

  const catalog = new Set(modules.flatMap((m) => m.permissions))
  for (const group of Object.values(api.groups)) {
    if (Option.isSome(Context.getOption(group.annotations, Public))) continue
    for (const endpoint of Object.values(group.endpoints)) {
      const where = `${group.identifier}.${endpoint.identifier}`
      if (!endpoint.middlewares.has(Authorization))
        errors.push(`${where}: non-public endpoint without the Authorization middleware`)
      const policy = Context.getOption(endpoint.annotations, Policy)
      if (Option.isNone(policy)) errors.push(`${where}: non-public endpoint without a Policy`)
      else if (policy.value !== 'signedIn' && !catalog.has(policy.value))
        errors.push(`${where}: policy "${policy.value}" is not a composed permission`)
    }
  }
  if (errors.length > 0) throw new CompositionError(errors.join('\n'))

  let services: Layer.Layer<never, unknown, unknown> = Layer.mergeAll(
    Layer.succeed(Composed, {
      modules: modules.map((m) => m.id),
      permissions: [...catalog],
      auditActions,
    }),
    Layer.succeed(ContentLocales, contentLocales),
  )
  for (const m of modules) if (m.layer) services = Layer.provideMerge(m.layer, services)

  const handlers = modules.map((m) => {
    const own = new Set(m.groups.map((g) => g.identifier))
    return m.handlers(makeApi(Object.values(api.groups).filter((g) => own.has(g.identifier))))
  })
  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(Layer.provide(Layer.mergeAll(Layer.empty, ...handlers), services)),
  )

  return { modules, apiPrefix, api, layer, services }
}

// HttpApi and HttpApiGroup are invariant in their group/endpoint types, and composition only knows
// groups as Top at runtime. The casts below erase the precise types only; values are unchanged.
const makeApi = (groups: ReadonlyArray<HttpApiGroup.Top>): HttpApi.Top =>
  groups.reduce((api, g) => api.add(g), HttpApi.make(apiId) as unknown as HttpApi.Top)

const prefixGroup = (group: HttpApiGroup.Constraint, prefix: `/${string}`): HttpApiGroup.Top =>
  (group as HttpApiGroup.Top).prefix(prefix) as unknown as HttpApiGroup.Top

function sortModules(input: ReadonlyArray<Module>): ReadonlyArray<Module> {
  const ids = new Set<string>()
  const errors: Array<string> = []
  for (const m of input) {
    if (!idPattern.test(m.id)) errors.push(`module id "${m.id}" must match ${idPattern}`)
    if (ids.has(m.id)) errors.push(`duplicate module id "${m.id}"`)
    ids.add(m.id)
  }
  for (const m of input)
    for (const d of m.dependsOn)
      if (!ids.has(d)) errors.push(`${m.id}: dependsOn unknown module "${d}"`)
  if (errors.length > 0) throw new CompositionError(errors.join('\n'))

  const sorted: Array<Module> = []
  const placed = new Set<string>()
  while (sorted.length < input.length) {
    const next = input.find((m) => !placed.has(m.id) && m.dependsOn.every((d) => placed.has(d)))
    if (!next) {
      const rest = input.filter((m) => !placed.has(m.id)).map((m) => m.id)
      throw new CompositionError(`dependency cycle among modules: ${rest.join(', ')}`)
    }
    sorted.push(next)
    placed.add(next.id)
  }
  return sorted
}
