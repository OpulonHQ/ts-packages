import {
  Audit,
  Background,
  CachePurge,
  CachePurger,
  CurrentActor,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  CmsConflict,
  type CmsInvalid,
  CmsNotFound,
  type PageLocale,
  revisionPageSize,
} from '../api.ts'
import { cacheTags } from './cache.ts'
import { uuid } from './document.ts'
import { Redirects } from './redirects.ts'

/** What `cms.document.kind` holds; `key` names the system page, collection or menu. */
export type DocumentKind = 'page' | 'item' | 'settings' | 'menu'

/** A document row with its draft and published documents decoded. */
export interface DocumentRow<D> {
  readonly id: string
  readonly key: string | null
  readonly draft: D
  readonly published: D | null
  /** Published and the draft equals it. */
  readonly inSync: boolean
  readonly publishedAt: Date | null
  readonly publishedRevisionId: string | null
  readonly updatedAt: Date
  readonly version: number
}

/** A published path of a routed document (page or item). */
export interface PublishedPath {
  readonly locale: string
  readonly path: string
}

/** How one kind of document is validated, permitted, audited and purged. */
export interface DocumentSpec<D> {
  readonly kind: DocumentKind
  readonly schema: Schema.Decoder<D>
  /** Singletons (site settings, menus) are found by key and created on first read. */
  readonly singleton?: { readonly empty: D }
  readonly permissions: { readonly view: string; readonly edit: string; readonly publish: string }
  readonly actions: {
    readonly restored: string
    readonly published: string
    readonly unpublished: string
    readonly deleted?: string
  }
  readonly subject: (row: DocumentRow<D>) => {
    readonly type: string
    readonly id: string
    readonly label: string
  }
  /** Cache-Tags purged when the published document changes. */
  readonly tags: (row: DocumentRow<D>) => ReadonlyArray<string>
  /** Validates and normalizes a draft; `key` is the document's key (an item's collection). */
  readonly normalize: (key: string | null, document: D) => Effect.Effect<D, CmsInvalid>
  /** Publishing needs these to pass on top of `normalize`. */
  readonly checkRequired: (key: string | null, document: D) => Effect.Effect<void, CmsInvalid>
  /** Routed documents (pages, items) have a path and availability per content locale. */
  readonly routes?: (document: D) => Readonly<Record<string, PageLocale>>
  /** Refuses deleting some documents (system pages). */
  readonly beforeRemove?: (row: DocumentRow<D>) => Effect.Effect<void, CmsConflict>
}

const Row = Schema.Struct({
  id: Schema.String,
  key: Schema.NullOr(Schema.String),
  draft: Schema.Unknown,
  published: Schema.Unknown,
  in_sync: Schema.Boolean,
  published_at: Schema.NullOr(Schema.Date),
  published_revision_id: Schema.NullOr(Schema.String),
  updated_at: Schema.Date,
  version: Schema.Number,
})
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))
const columns = `id, key, draft, published, coalesce(draft = published, false) as in_sync,
  published_at, published_revision_id, updated_at, version`

/** Status of a document as the admin shows it. */
export const documentState = (row: DocumentRow<unknown>) => ({
  status:
    row.published === null
      ? ('draft' as const)
      : row.inSync
        ? ('published' as const)
        : ('changed' as const),
  updatedAt: row.updatedAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
  version: row.version,
})

/**
 * The draft/publish store every kind of cms document shares (TSPACK-11): one row per document,
 * draft and published JSON, a revision per publish, the publish family audited and purged.
 * `documents(spec)` binds it to one kind. Every method checks the actor's permission itself.
 */
export const makeDocuments = Effect.gen(function* () {
  const sql = yield* SqlClient
  const purger = yield* CachePurger
  const background = yield* Background
  const redirects = yield* Redirects
  const withSql = Effect.provideService(SqlClient, sql)

  /** Fails when another page or item uses one of the paths (in its draft or published). */
  const checkPaths = (id: string | null, routes: Readonly<Record<string, PageLocale>>) =>
    Effect.gen(function* () {
      const wanted = Object.entries(routes).filter(([, l]) => l.path !== '')
      if (wanted.length === 0) return
      const paths = [...new Set(wanted.map(([, l]) => l.path))]
      const taken = yield* sql<{ locale: string; path: string }>`
        select l.key as locale, l.value->>'path' as path
        from cms.document d cross join jsonb_each(d.draft->'locales') l
        where d.kind in ('page', 'item') and d.id is distinct from ${id}
          and l.value->>'path' in ${sql.in(paths)}
        union
        select locale, path from cms.path
        where document_id is distinct from ${id} and path in ${sql.in(paths)}`
      const clash = wanted.find(([locale, l]) =>
        taken.some((t) => t.locale === locale && t.path === l.path),
      )
      if (clash)
        return yield* new CmsConflict({
          reason: 'path_taken',
          message: `Another page or item already uses the ${clash[0]} path "${clash[1].path}".`,
        })
    })

  /**
   * Replaces a routed document's published paths and returns them before and after. The one
   * place where a published path changes: publish and unpublish go through it (delete
   * cascades); publish hands the change to `Redirects.pathsChanged`.
   */
  const replacePaths = (id: string, next: ReadonlyArray<PublishedPath>) =>
    Effect.gen(function* () {
      const previous = yield* sql<PublishedPath>`delete from cms.path where document_id = ${id}
        returning locale, path`
      for (const { locale, path } of next)
        yield* sql`insert into cms.path (locale, path, document_id) values (${locale}, ${path}, ${id})`
      return { previous, next }
    })

  return <D>(spec: DocumentSpec<D>) => {
    /** A routed document's published paths may change on every publish family write. */
    const purge = (tags: ReadonlyArray<string>) =>
      CachePurge.afterCommit(spec.routes ? [...tags, cacheTags.routes] : tags).pipe(
        Effect.provideService(Background, background),
        Effect.provideService(CachePurger, purger),
      )
    const decodeDocument = Schema.decodeUnknownEffect(spec.schema)
    const toRow = (raw: typeof Row.Type) =>
      Effect.gen(function* () {
        const draft = yield* decodeDocument(raw.draft)
        const published = raw.published === null ? null : yield* decodeDocument(raw.published)
        return {
          id: raw.id,
          key: raw.key,
          draft,
          published,
          inSync: raw.in_sync,
          publishedAt: raw.published_at,
          publishedRevisionId: raw.published_revision_id,
          updatedAt: raw.updated_at,
          version: raw.version,
        } satisfies DocumentRow<D>
      })
    const one = <E>(query: Effect.Effect<ReadonlyArray<unknown>, E>, ref: string) =>
      Effect.gen(function* () {
        const [raw] = yield* decodeRows(yield* query)
        return raw ? yield* toRow(raw) : yield* new CmsNotFound({ id: ref })
      })
    const lock = (forUpdate: boolean) => sql.literal(forUpdate ? 'for update' : '')
    const writeDraft = (row: DocumentRow<D>, draft: D, ref: string) =>
      one(
        sql`update cms.document
          set draft = ${JSON.stringify(draft)}::jsonb, updated_at = now(), version = version + 1
          where id = ${row.id} returning ${sql.literal(columns)}`,
        ref,
      )
    const checkVersion = (row: DocumentRow<D>, version: number) =>
      row.version === version
        ? Effect.void
        : Effect.fail(
            new CmsConflict({
              reason: 'draft_changed',
              message: 'Someone else changed this draft after you opened it.',
            }),
          )

    /** By id, or by key for singletons (created with an empty draft on first read). */
    const find = (ref: string, forUpdate = false) =>
      Effect.gen(function* () {
        if (spec.singleton) {
          yield* sql`insert into cms.document (id, kind, key, draft)
            values (${crypto.randomUUID()}, ${spec.kind}, ${ref},
              ${JSON.stringify(spec.singleton.empty)}::jsonb)
            on conflict (kind, key) where kind in ('settings', 'menu') do nothing`
          return yield* one(
            sql`select ${sql.literal(columns)} from cms.document
              where kind = ${spec.kind} and key = ${ref} ${lock(forUpdate)}`,
            ref,
          )
        }
        if (!uuid.test(ref)) return yield* new CmsNotFound({ id: ref })
        return yield* one(
          sql`select ${sql.literal(columns)} from cms.document
            where id = ${ref} and kind = ${spec.kind} ${lock(forUpdate)}`,
          ref,
        )
      })

    const publishedPaths = (document: D): ReadonlyArray<PublishedPath> =>
      Object.entries(spec.routes?.(document) ?? {})
        .filter(([, l]) => l.available && l.path !== '')
        .map(([locale, l]) => ({ locale, path: l.path }))

    const RevisionRow = Schema.Struct({
      id: Schema.String,
      created_at: Schema.Date,
      created_by: Schema.NullOr(Schema.String),
      created_by_name: Schema.String,
    })
    const summary = (row: typeof RevisionRow.Type) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      author: { id: row.created_by, name: row.created_by_name },
    })
    const revision = (documentId: string, revisionId: string) =>
      Effect.gen(function* () {
        if (!uuid.test(revisionId)) return yield* new CmsNotFound({ id: revisionId })
        const [row] = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ ...RevisionRow.fields, document: Schema.Unknown })),
        )(
          yield* sql`select id, created_at, created_by, created_by_name, document
          from cms.revision where id = ${revisionId} and document_id = ${documentId}`,
        )
        if (!row) return yield* new CmsNotFound({ id: revisionId })
        return { ...summary(row), document: yield* decodeDocument(row.document) }
      })

    return {
      listRevisions: Effect.fn('Documents.listRevisions')(
        function* (ref: string, page = 1) {
          yield* requirePermission(spec.permissions.view)
          const row = yield* find(ref)
          const revisions = yield* Schema.decodeUnknownEffect(Schema.Array(RevisionRow))(
            yield* sql`select id, created_at, created_by, created_by_name from cms.revision
              where document_id = ${row.id} order by created_at desc, id desc
              limit ${revisionPageSize} offset ${(page - 1) * revisionPageSize}`,
          )
          const [count] = yield* sql<{ total: number }>`select count(*)::int as total
            from cms.revision where document_id = ${row.id}`
          return { rows: revisions.map(summary), total: count?.total ?? 0 }
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      getRevision: Effect.fn('Documents.getRevision')(
        function* (ref: string, revisionId: string) {
          yield* requirePermission(spec.permissions.view)
          const row = yield* find(ref)
          return yield* revision(row.id, revisionId)
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      restoreRevision: Effect.fn('Documents.restoreRevision')(
        function* (ref: string, revisionId: string) {
          yield* requirePermission(spec.permissions.publish)
          return yield* withTransaction(
            Effect.gen(function* () {
              const row = yield* find(ref, true)
              const snapshot = yield* revision(row.id, revisionId)
              const draft = yield* spec.normalize(row.key, snapshot.document)
              if (spec.routes) yield* checkPaths(row.id, spec.routes(draft))
              const restored = yield* writeDraft(row, draft, ref)
              yield* Audit.record({
                action: spec.actions.restored,
                subject: spec.subject(restored),
                context: { revisionId },
              })
              return restored
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      /** All documents of the kind, or of one key (an item's collection). */
      list: Effect.fn('Documents.list')(
        function* (key: string | null) {
          yield* requirePermission(spec.permissions.view)
          const rows = yield* decodeRows(
            yield* sql`select ${sql.literal(columns)} from cms.document
              where kind = ${spec.kind} ${key === null ? sql`` : sql`and key = ${key}`}
              order by key is null, key, updated_at desc, id`,
          )
          return yield* Effect.forEach(rows, toRow)
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      get: Effect.fn('Documents.get')(
        function* (ref: string) {
          yield* requirePermission(spec.permissions.view)
          return yield* find(ref)
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      create: Effect.fn('Documents.create')(
        function* (key: string | null, input: D) {
          yield* requirePermission(spec.permissions.edit)
          const draft = yield* spec.normalize(key, input)
          return yield* withTransaction(
            Effect.gen(function* () {
              if (spec.routes) yield* checkPaths(null, spec.routes(draft))
              const [raw] = yield* decodeRows(
                yield* sql`insert into cms.document (id, kind, key, draft)
                  values (${crypto.randomUUID()}, ${spec.kind}, ${key}, ${JSON.stringify(draft)}::jsonb)
                  returning ${sql.literal(columns)}`,
              )
              return yield* toRow(raw!)
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      saveDraft: Effect.fn('Documents.saveDraft')(
        function* (ref: string, version: number, input: D) {
          yield* requirePermission(spec.permissions.edit)
          return yield* withTransaction(
            Effect.gen(function* () {
              const row = yield* find(ref, true)
              yield* checkVersion(row, version)
              const draft = yield* spec.normalize(row.key, input)
              if (spec.routes) yield* checkPaths(row.id, spec.routes(draft))
              return yield* writeDraft(row, draft, ref)
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      remove: Effect.fn('Documents.remove')(
        function* (ref: string) {
          yield* requirePermission(spec.permissions.edit)
          yield* withTransaction(
            Effect.gen(function* () {
              const row = yield* find(ref, true)
              if (spec.beforeRemove) yield* spec.beforeRemove(row)
              yield* sql`delete from cms.document where id = ${row.id}`
              if (spec.actions.deleted)
                yield* Audit.record({ action: spec.actions.deleted, subject: spec.subject(row) })
              if (row.published !== null) yield* purge(spec.tags(row))
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      /** Copies the draft to published, records a revision, audits and purges. */
      publish: Effect.fn('Documents.publish')(
        function* (ref: string, version: number) {
          yield* requirePermission(spec.permissions.publish)
          const actor = yield* CurrentActor
          return yield* withTransaction(
            Effect.gen(function* () {
              const row = yield* find(ref, true)
              yield* checkVersion(row, version)

              // Again, as the definitions may have changed since the draft was saved.
              const draft = yield* spec.normalize(row.key, row.draft)
              yield* spec.checkRequired(row.key, draft)
              if (spec.routes) yield* checkPaths(row.id, spec.routes(draft))
              const document = JSON.stringify(draft)
              const revisionId = crypto.randomUUID()
              yield* sql`insert into cms.revision
                (id, document_id, reason, document, created_by, created_by_name)
                values (${revisionId}, ${row.id}, 'publish', ${document}::jsonb,
                  ${actor.kind === 'user' ? actor.id : null}, ${actor.name ?? 'Anonymous'})`
              const published = yield* one(
                sql`update cms.document set draft = ${document}::jsonb,
                  published = ${document}::jsonb, published_at = now(),
                  published_revision_id = ${revisionId}
                  where id = ${row.id} returning ${sql.literal(columns)}`,
                ref,
              )
              if (spec.routes) {
                const { previous, next } = yield* replacePaths(row.id, publishedPaths(draft))

                // Old paths redirect to the new ones (TSPACK-34).
                yield* redirects.pathsChanged(row.id, previous, next)
              }
              yield* Audit.record({
                action: spec.actions.published,
                subject: spec.subject(published),
                context: { revisionId },
              })
              yield* purge(spec.tags(published))
              return published
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),

      unpublish: Effect.fn('Documents.unpublish')(
        function* (ref: string) {
          yield* requirePermission(spec.permissions.publish)
          return yield* withTransaction(
            Effect.gen(function* () {
              const row = yield* find(ref, true)
              if (row.published === null) return row
              const after = yield* one(
                sql`update cms.document set published = null, published_at = null,
                  published_revision_id = null
                  where id = ${row.id} returning ${sql.literal(columns)}`,
                ref,
              )
              if (spec.routes) yield* replacePaths(row.id, [])
              yield* Audit.record({
                action: spec.actions.unpublished,
                subject: spec.subject(after),
              })
              yield* purge(spec.tags(after))
              return after
            }),
          )
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        withSql,
      ),
    }
  }
})
