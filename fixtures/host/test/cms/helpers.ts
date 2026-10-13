import type { Page, PageDocument, PageLocale } from '@opulonjs/cms/api'
import { CachePurge } from '@opulonjs/cms/server'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Mailer } from '@opulonjs/emails/server'
import { R2MediaStorage } from '@opulonjs/media/server'
import { Effect, Layer } from 'effect'
import { adminQuery } from '../../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../../test/postgres/index.ts'
import { server } from '../../server/opulon.ts'
import { memoryBucket } from '../memory-bucket.ts'
import { origin, sessions, usersEnv } from '../support/users.ts'

const editor = [
  'cms.pages.view',
  'cms.pages.edit',
  'cms.pages.publish',
  'cms.collections.view',
  'cms.collections.edit',
  'cms.collections.publish',
  'cms.site.view',
  'cms.site.edit',
  'cms.site.publish',
  'cms.redirects.view',
  'cms.redirects.edit',
  'media.view',
  'media.upload',
]

/**
 * The fixture host's composed server behind a test Worker that records cache purges. The
 * editor holds every cms permission; `as` narrows them, null sends no credentials. `composed`
 * replaces the fixture host's server (its `call` helper assumes the default `/api` prefix).
 */
export const useCmsHost = (composed = server) => {
  const db = useTestDatabase()
  const purged: Array<ReadonlyArray<string>> = []
  const worker = createWorker(composed, {
    infra: (env: typeof usersEnv & { url: string }) =>
      Layer.mergeAll(
        PgFromHyperdrive({ connectionString: env.url }),
        R2MediaStorage(memoryBucket()),
        Mailer.log,
        Layer.succeed(CachePurge, { purge: (tags) => Effect.sync(() => purged.push(tags)) }),
      ),
    buildId: () => 'build-1',
  })

  const env = () => ({ url: db.url, ...usersEnv })
  const send = async (request: Request) => {
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(request, env(), {
      waitUntil: (p) => pending.push(p),
    })
    const body = await response.arrayBuffer()
    await Promise.all(pending)
    return new Response(response.status === 204 ? null : body, response)
  }

  // The editor holds every cms permission; `as` narrows them (one seeded user per set).
  const session = sessions(() => db.url, send)
  const editorName = { name: 'Eda Editor', locale: 'sk' }

  const call = async <Body = unknown>(
    method: string,
    path: string,
    { body, as }: { body?: unknown; as?: ReadonlyArray<string> | null } = {},
  ) => {
    const headers = new Headers({ origin })
    if (as !== null) headers.set('cookie', await session(as ?? editor, editorName))
    if (body !== undefined) headers.set('content-type', 'application/json')
    const response = await send(
      new Request(`https://host.test/api/cms${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      }),
    )
    const text = await response.text()
    return {
      status: response.status,
      headers: response.headers,
      // Typed by the caller (the API's success schema); error bodies are only matched.
      body: (text ? JSON.parse(text) : undefined) as Body,
    }
  }

  /** A `fetch` routed into the test Worker as the editor, for admin screens. */
  const hostFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    request.headers.set('origin', origin)
    request.headers.set('cookie', await session(editor, editorName))
    return send(request)
  }

  return {
    db,
    purged,
    call,
    fetch: hostFetch,
    /** An anonymous `fetch` into the test Worker, as a public site's browser makes it. */
    publicFetch: (async (input, init) => send(new Request(input, init))) as typeof fetch,
    /** The test Worker and its env, for code that calls `worker.fetch(request, env, ctx)`. */
    worker,
    env,
    /** The editor's session cookie. */
    cookie: () => session(editor, editorName),
    query: <R extends Record<string, unknown>>(sql: string) => adminQuery<R>(db.url, sql),
    create: (draft: PageDocument) => call<Page>('POST', '/pages', { body: draft }),
    save: (id: string, draft: PageDocument) =>
      call<Page>('PUT', `/pages/${id}/draft`, { body: draft }),
    publish: (id: string) => call<Page>('POST', `/pages/${id}/publish`),
    /** Uploads a media file as the editor, with alt text per locale; resolves with its id. */
    upload: async (bytes: Uint8Array, name: string, alt: Record<string, string> = {}) => {
      const data = new FormData()
      data.append('file', new File([bytes.slice()], name, { type: 'image/png' }))
      const media = (path: string, init: RequestInit) =>
        hostFetch(`https://host.test/api/media${path}`, init).then(
          (r) => r.json() as Promise<{ id: string }>,
        )
      const { id } = await media('/items', {
        method: 'POST',
        body: await new Response(data).blob(),
      })
      await media(`/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alt }),
      })
      return id
    },
  }
}

export const locale = (path: string, overrides: Partial<PageLocale> = {}): PageLocale => ({
  path,
  available: true,
  seo: { title: '', description: '', image: null, noindex: false },
  ...overrides,
})

/** A draft with a path in both content locales and the given sections. */
export const page = (
  paths: { en: string; it?: string },
  sections: PageDocument['sections'] = [],
): PageDocument => ({
  locales: {
    en: locale(paths.en),
    ...(paths.it ? { it: locale(paths.it) } : {}),
  },
  sections,
})

export const section = (type: string, data: Record<string, unknown>, id = crypto.randomUUID()) => ({
  id,
  type,
  data,
})
