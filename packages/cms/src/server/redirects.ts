import {
  Audit,
  Background,
  ContentLocales,
  diffFields,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  CmsConflict,
  CmsInvalid,
  CmsNotFound,
  type Redirect,
  type RedirectImportResult,
  type RedirectInput,
  redirectImportLimits,
  RedirectStatus,
} from '../api.ts'
import { CachePurge, cacheTags, purgeAfterCommit } from './cache.ts'
import { parseCsv } from './csv.ts'
import { maxPathLength, uuid } from './document.ts'

/** Starts with one `/` (not `//`); no whitespace, control characters, `\`, query or fragment. */
const pathPattern = /^\/(?!\/)[^\s?#\\\p{Cc}]*$/u

/**
 * The canonical form of a decoded path, as the Read API's `resolve` passes it: dot segments
 * resolved (never above the root), empty segments (repeated or trailing slashes) dropped.
 * Undefined when it is not a locale-relative path.
 */
export const canonicalPath = (path: string) => {
  if (!pathPattern.test(path)) return undefined
  const segments: Array<string> = []
  for (const segment of path.split('/'))
    if (segment === '..') segments.pop()
    else if (segment !== '' && segment !== '.') segments.push(segment)
  return `/${segments.join('/')}`
}

/**
 * The form redirect paths are stored and compared in, from what an editor writes (a URL path):
 * trimmed, percent-escapes decoded once (`/caf%C3%A9` is `/café`, as `resolve` decodes request
 * paths), then canonical (`/a//b/../c/` is `/a/c`). Undefined when it is not a path.
 */
export const redirectPath = (raw: string) => {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw.trim())
  } catch {
    return undefined
  }
  return decoded.length > maxPathLength ? undefined : canonicalPath(decoded)
}

const notAPath = (raw: string) =>
  `"${raw.slice(0, 200)}" is not a path: it must start with "/" and have no spaces, "?", "#" ` +
  `or "\\" (at most ${maxPathLength} characters).`

interface Rule {
  readonly id: string
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly status: RedirectStatus
  readonly auto: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

const Row = Schema.Struct({
  id: Schema.String,
  locale: Schema.String,
  from_path: Schema.String,
  to_path: Schema.String,
  status: RedirectStatus,
  auto: Schema.Boolean,
  created_at: Schema.Date,
  updated_at: Schema.Date,
})
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))
const columns = 'id, locale, from_path, to_path, status, auto, created_at, updated_at'

const toRedirect = (rule: Rule): Redirect => ({
  id: rule.id,
  locale: rule.locale,
  from: rule.from,
  to: rule.to,
  status: rule.status,
  auto: rule.auto,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
})
const subject = (rule: Rule) => ({ type: 'redirect', id: rule.id, label: rule.from })
const conflict = (reason: CmsConflict['reason'], message: string) =>
  new CmsConflict({ reason, message })
const key = (locale: string, path: string) => `${locale}\n${path}`

/**
 * The redirects of some locales in memory, kept flat: every write that would make a chain
 * points the chain's start straight at its end, and writes that would loop, repeat a `from`
 * path or shadow a published path are refused. `changes()` lists what to write back.
 */
const plan = (rows: ReadonlyArray<Rule>, published: ReadonlySet<string>) => {
  const original = new Map(rows.map((r) => [r.id, r]))
  const rules = new Map(rows.map((r) => [key(r.locale, r.from), r]))
  const now = new Date()
  return {
    get: (locale: string, from: string) => rules.get(key(locale, from)),
    byId: (id: string) => [...rules.values()].find((r) => r.id === id),
    remove: (rule: Rule) => rules.delete(key(rule.locale, rule.from)),
    /** Adds or replaces (same id, same from) a redirect; checks everything before mutating. */
    put: (rule: Omit<Rule, 'createdAt' | 'updatedAt'>): CmsConflict | Rule => {
      const { locale, from, to } = rule
      if (from === to)
        return conflict('redirect_loop', `A redirect from "${from}" to itself would loop.`)
      if (published.has(key(locale, from)))
        return conflict('path_taken', `"${from}" is the path of a published page.`)
      const existing = rules.get(key(locale, from))
      if (existing && existing.id !== rule.id)
        return conflict('redirect_taken', `"${from}" already redirects to "${existing.to}".`)
      // `to` may itself be redirected (one hop at most, as the set is flat).
      const target = rules.get(key(locale, to))?.to ?? to
      if (target === from)
        return conflict('redirect_loop', `"${from}" → "${to}" would loop back to "${from}".`)
      // ponytail: linear scan per write; index rules by target if imports grow past ~10k.
      for (const [k, r] of rules)
        if (r.locale === locale && r.to === from) rules.set(k, { ...r, to: target, updatedAt: now })
      const written: Rule = {
        ...rule,
        to: target,
        createdAt: original.get(rule.id)?.createdAt ?? now,
        updatedAt: now,
      }
      rules.set(key(locale, from), written)
      return written
    },
    /** Ids to delete (removed or rewritten) and rules to insert (new or rewritten). */
    changes: () => {
      const final = new Map([...rules.values()].map((r) => [r.id, r]))
      const insert = [...final.values()].filter((r) => original.get(r.id) !== r)
      const drop = [...original.keys()].filter((id) => final.get(id) !== original.get(id))
      return { drop, insert }
    },
  }
}
type Plan = ReturnType<typeof plan>

type Failure = Forbidden | CmsInvalid | CmsConflict

/**
 * Exact-path redirects per content locale (TSPACK-11 decision 10). Editor methods check the
 * actor's permission; `lookup` is the public read the Read API's `resolve` uses, and
 * `pathsChanged` is called by publishing inside its transaction.
 */
export class Redirects extends Context.Service<
  Redirects,
  {
    /**
     * The redirect for a decoded, locale-relative request path (compared in canonical form:
     * dot segments, repeated and trailing slashes ignored), if any.
     */
    readonly lookup: (
      locale: string,
      path: string,
    ) => Effect.Effect<Option.Option<{ readonly to: string; readonly status: RedirectStatus }>>
    readonly list: () => Effect.Effect<{ rows: ReadonlyArray<Redirect>; total: number }, Forbidden>
    readonly create: (input: RedirectInput) => Effect.Effect<Redirect, Failure>
    readonly update: (
      id: string,
      input: RedirectInput,
    ) => Effect.Effect<Redirect, Failure | CmsNotFound>
    readonly remove: (id: string) => Effect.Effect<void, Forbidden | CmsNotFound>
    /** Parses and applies a CSV file with a `from,to[,status][,locale]` header row. */
    readonly importCsv: (csv: string) => Effect.Effect<RedirectImportResult, Forbidden | CmsInvalid>
    /**
     * A document's published paths changed from `before` to `after` (one per locale): its
     * old paths redirect (301) to the new ones, and redirects from its new paths are dropped,
     * as the document now answers there. Run inside the publishing transaction, after
     * `cms.path` holds the new paths. No permission check: the caller holds its own.
     */
    readonly pathsChanged: (
      documentId: string,
      before: ReadonlyArray<{ readonly locale: string; readonly path: string }>,
      after: ReadonlyArray<{ readonly locale: string; readonly path: string }>,
    ) => Effect.Effect<void, CmsConflict>
  }
>()('@opulonjs/cms/Redirects') {
  static readonly layer = Layer.effect(
    Redirects,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const locales = yield* ContentLocales
      const defaultLocale = locales[0]!
      // Cached redirect and not-found answers carry `cms:routes`.
      const purge = purgeAfterCommit([cacheTags.routes]).pipe(
        Effect.provideService(Background, yield* Background),
        Effect.provideService(CachePurge, yield* CachePurge),
      )

      /** Loads the redirects and published paths of `of` under a lock that serializes
       *  redirect writers, so the flat-set checks see every concurrent write. */
      const load = (of: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          yield* sql`lock table cms.redirect in share row exclusive mode`
          const rows = yield* decodeRows(
            yield* sql`select ${sql.literal(columns)} from cms.redirect
              where locale in ${sql.in(of)}`,
          )
          const paths = yield* sql<{ locale: string; path: string }>`
            select locale, path from cms.path where locale in ${sql.in(of)}`
          return plan(
            rows.map((r) => ({
              id: r.id,
              locale: r.locale,
              from: r.from_path,
              to: r.to_path,
              status: r.status,
              auto: r.auto,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })),
            new Set(paths.map((p) => key(p.locale, p.path))),
          )
        })

      const write = (p: Plan) =>
        Effect.gen(function* () {
          const { drop, insert } = p.changes()
          if (drop.length + insert.length > 0) yield* purge
          if (drop.length > 0) yield* sql`delete from cms.redirect where id in ${sql.in(drop)}`
          for (let i = 0; i < insert.length; i += 1000)
            yield* sql`insert into cms.redirect ${sql.insert(
              insert.slice(i, i + 1000).map((r) => ({
                id: r.id,
                locale: r.locale,
                from_path: r.from,
                to_path: r.to,
                status: r.status,
                auto: r.auto,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
              })),
            )}`
        })

      /**
       * `raw` as a redirect path of `locale`, identified as the Read API's `resolve` does, or why
       * it is not one. In the default locale, resolve redirects its own prefix away (`/en/x` is
       * `/x`) and answers other locales under theirs, so a `from` there would never be reached
       * (a `to` there is a cross-locale target).
       */
      const localePath = (
        locale: string,
        raw: string,
        side: 'from' | 'to',
      ): { path: string } | { error: string } => {
        const path = redirectPath(raw)
        if (path === undefined) return { error: notAPath(raw) }
        const first = path.split('/')[1]!
        if (locale !== defaultLocale || !locales.includes(first)) return { path }
        if (first === defaultLocale) {
          // Dropped once only: what remains under a locale prefix (`/en/en/x`, `/en/it/x`)
          // resolves elsewhere and could loop back.
          const rest = path.slice(first.length + 1) || '/'
          const next = rest.split('/')[1]!
          return locales.includes(next)
            ? { error: `"${path}" has another locale prefix after "/${first}".` }
            : { path: rest }
        }
        return side === 'to'
          ? { path }
          : { error: `"${path}" starts with "/${first}", the prefix of ${first} pages.` }
      }

      const validate = (input: RedirectInput) =>
        Effect.gen(function* () {
          if (!locales.includes(input.locale))
            return yield* new CmsInvalid({ message: `"${input.locale}" is not a content locale.` })
          const from = localePath(input.locale, input.from, 'from')
          if ('error' in from) return yield* new CmsInvalid({ message: from.error })
          const to = localePath(input.locale, input.to, 'to')
          if ('error' in to) return yield* new CmsInvalid({ message: to.error })
          return { locale: input.locale, from: from.path, to: to.path, status: input.status }
        })

      const find = (p: Plan, id: string) => {
        const rule = uuid.test(id) ? p.byId(id) : undefined
        return rule ? Effect.succeed(rule) : Effect.fail(new CmsNotFound({ id }))
      }
      const applied = (result: CmsConflict | Rule) =>
        result instanceof CmsConflict ? Effect.fail(result) : Effect.succeed(result)

      const withSql = Effect.provideService(SqlClient, sql)

      return {
        lookup: Effect.fn('Redirects.lookup')(
          function* (locale: string, path: string) {
            // Already decoded by the caller: canonical only, never decoded twice.
            const from = canonicalPath(path)
            if (from === undefined) return Option.none()
            const [row] = yield* sql<{ to_path: string; status: RedirectStatus }>`
              select to_path, status from cms.redirect
              where locale = ${locale} and from_path = ${from}`
            return Option.fromNullishOr(row).pipe(
              Option.map((r) => ({ to: r.to_path, status: r.status })),
            )
          },
          Effect.catchTag('SqlError', Effect.die),
          withSql,
        ),

        list: Effect.fn('Redirects.list')(
          function* () {
            yield* requirePermission('cms.redirects.view')
            const rows = yield* decodeRows(
              yield* sql`select ${sql.literal(columns)} from cms.redirect
                order by locale, from_path`,
            )
            const redirects = rows.map((r) =>
              toRedirect({
                ...r,
                from: r.from_path,
                to: r.to_path,
                createdAt: r.created_at,
                updatedAt: r.updated_at,
              }),
            )
            return { rows: redirects, total: redirects.length }
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),

        create: Effect.fn('Redirects.create')(
          function* (input: RedirectInput) {
            yield* requirePermission('cms.redirects.edit')
            const valid = yield* validate(input)
            return yield* withTransaction(
              Effect.gen(function* () {
                const p = yield* load([valid.locale])
                const rule = yield* applied(
                  p.put({ ...valid, id: crypto.randomUUID(), auto: false }),
                )
                yield* write(p)
                yield* Audit.record({ action: 'cms.redirect.created', subject: subject(rule) })
                return toRedirect(rule)
              }),
            )
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),

        update: Effect.fn('Redirects.update')(
          function* (id: string, input: RedirectInput) {
            yield* requirePermission('cms.redirects.edit')
            const valid = yield* validate(input)
            return yield* withTransaction(
              Effect.gen(function* () {
                const p = yield* load(locales)
                const before = yield* find(p, id)
                p.remove(before)
                const rule = yield* applied(p.put({ ...valid, id, auto: before.auto }))
                yield* write(p)
                yield* Audit.record({
                  action: 'cms.redirect.updated',
                  subject: subject(before),
                  changes: diffFields(before, rule, ['locale', 'from', 'to', 'status']),
                })
                return toRedirect(rule)
              }),
            )
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),

        remove: Effect.fn('Redirects.remove')(
          function* (id: string) {
            yield* requirePermission('cms.redirects.edit')
            yield* withTransaction(
              Effect.gen(function* () {
                const p = yield* load(locales)
                const rule = yield* find(p, id)
                p.remove(rule)
                yield* write(p)
                yield* Audit.record({ action: 'cms.redirect.deleted', subject: subject(rule) })
              }),
            )
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),

        importCsv: Effect.fn('Redirects.importCsv')(
          function* (csv: string) {
            yield* requirePermission('cms.redirects.edit')
            const invalid = (message: string) => new CmsInvalid({ message })
            const rows = parseCsv(csv)
            if (rows === undefined)
              return yield* invalid('The file has a quoted field that is never closed.')
            const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
            const column = (name: string) => header.indexOf(name)
            const [from, to, status, locale] = ['from', 'to', 'status', 'locale'].map(column)
            if (from === -1 || to === -1)
              return yield* invalid(
                'The first row must name the columns: "from" and "to", optionally "status" and "locale".',
              )
            const data = rows.slice(1)
            if (data.length > redirectImportLimits.maxRows)
              return yield* invalid(
                `The file has ${data.length} rows; import at most ${redirectImportLimits.maxRows} at a time.`,
              )

            return yield* withTransaction(
              Effect.gen(function* () {
                const p = yield* load(locales)
                const result = {
                  created: 0,
                  skipped: 0,
                  errors: [] as Array<{ row: number; message: string }>,
                }
                data.forEach((cells, index) => {
                  const cell = (i: number | undefined) =>
                    i === undefined || i < 0 ? '' : (cells[i] ?? '').trim()
                  const fail = (message: string) => result.errors.push({ row: index + 2, message })
                  const rowLocale = cell(locale) || defaultLocale
                  const fromPath = localePath(rowLocale, cell(from), 'from')
                  if ('error' in fromPath) return fail(fromPath.error)
                  const toPath = localePath(rowLocale, cell(to), 'to')
                  if ('error' in toPath) return fail(toPath.error)
                  const rawStatus = cell(status) || '301'
                  if (rawStatus !== '301' && rawStatus !== '302')
                    return fail(`The status "${rawStatus.slice(0, 20)}" must be 301 or 302.`)
                  if (!locales.includes(rowLocale))
                    return fail(`"${rowLocale.slice(0, 20)}" is not a content locale.`)
                  if (p.get(rowLocale, fromPath.path)) {
                    result.skipped++
                    return
                  }
                  const outcome = p.put({
                    id: crypto.randomUUID(),
                    locale: rowLocale,
                    from: fromPath.path,
                    to: toPath.path,
                    status: rawStatus === '302' ? 302 : 301,
                    auto: false,
                  })
                  if (outcome instanceof CmsConflict) return fail(outcome.message)
                  result.created++
                })
                yield* write(p)
                yield* Audit.record({
                  action: 'cms.redirect.imported',
                  context: {
                    created: result.created,
                    skipped: result.skipped,
                    errors: result.errors.length,
                  },
                })
                return result
              }),
            )
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),

        pathsChanged: Effect.fn('Redirects.pathsChanged')(
          function* (
            documentId: string,
            before: ReadonlyArray<{ readonly locale: string; readonly path: string }>,
            after: ReadonlyArray<{ readonly locale: string; readonly path: string }>,
          ) {
            const touched = [...new Set([...before, ...after].map((l) => l.locale))]
            if (touched.length === 0) return
            const p = yield* load(touched)
            const deleted: Array<Rule> = []
            for (const { locale, path } of after) {
              const shadowed = p.get(locale, path)
              if (shadowed && p.remove(shadowed)) deleted.push(shadowed)
            }
            const created: Array<Rule> = []
            for (const old of before) {
              const next = after.find((a) => a.locale === old.locale)
              if (!next || next.path === old.path) continue
              created.push(
                yield* applied(
                  p.put({
                    id: crypto.randomUUID(),
                    locale: old.locale,
                    from: old.path,
                    to: next.path,
                    status: 301,
                    auto: true,
                  }),
                ),
              )
            }
            if (deleted.length === 0 && created.length === 0) return
            yield* write(p)
            for (const rule of deleted)
              yield* Audit.record({
                action: 'cms.redirect.deleted',
                subject: subject(rule),
                context: { documentId },
              })
            for (const rule of created)
              yield* Audit.record({
                action: 'cms.redirect.created',
                subject: subject(rule),
                context: { documentId },
              })
          },
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
          withSql,
        ),
      }
    }),
  )
}
