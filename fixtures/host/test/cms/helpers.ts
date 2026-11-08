import type { Page, PageDocument, PageLocale } from '@opulonjs/cms/api'
import { type WorkersCache, workersCachePurge } from '@opulonjs/core/workers'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Mailer } from '@opulonjs/emails/server'
import { R2MediaStorage } from '@opulonjs/media/server'
import { Layer } from 'effect'
import { expect } from 'vitest'
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
  'media.archive',
]

/**
 * The fixture host's composed server behind a test Worker whose Workers Cache (`ctx.cache`)
 * records purges, wired as the fixture host wires it. The
 * editor holds every cms permission; `as` narrows them, null sends no credentials. `composed`
 * replaces the fixture host's server (its `call` helper assumes the default `/api` prefix).
 */
export const useCmsHost = (composed = server, reply?: WorkersCache['purge']) => {
  const db = useTestDatabase()
  const purged: Array<ReadonlyArray<string>> = []
  const worker = createWorker(composed, {
    infra: (env: typeof usersEnv & { url: string }, ctx) =>
      Layer.mergeAll(
        PgFromHyperdrive({ connectionString: env.url }),
        R2MediaStorage(memoryBucket()),
        Mailer.log,
        workersCachePurge(ctx),
      ),
    buildId: () => 'build-1',
  })

  const env = () => ({ url: db.url, ...usersEnv })
  const send = async (request: Request) => {
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(request, env(), {
      waitUntil: (p) => pending.push(p),
      cache: {
        purge: async ({ tags }) => {
          purged.push(tags)
          return reply ? reply({ tags }) : { success: true, errors: [] }
        },
      },
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

  const missingVersion = 0
  const currentVersion = async (path: string) => {
    const { status, body } = await call<{ version: number }>('GET', path)
    return status === 200 ? body.version : missingVersion
  }
  type As = { as?: ReadonlyArray<string> | null }
  const saveDraft = async <Body = unknown>(path: string, body: unknown, { as }: As = {}) =>
    call<Body>('PUT', `${path}/draft?version=${await currentVersion(path)}`, { body, as })
  const publishDraft = async <Body = unknown>(path: string, { as }: As = {}) =>
    call<Body>('POST', `${path}/publish?version=${await currentVersion(path)}`, { as })

  /** A `fetch` routed into the test Worker as the editor, for admin screens. */
  const fetchAs =
    (permissions: ReadonlyArray<string>): typeof fetch =>
    async (input, init) => {
      const request = new Request(input, init)
      request.headers.set('origin', origin)
      request.headers.set('cookie', await session(permissions, editorName))
      return send(request)
    }
  const hostFetch = fetchAs(editor)

  return {
    db,
    purged,
    call,
    fetch: hostFetch,
    fetchAs,
    /** An anonymous `fetch` into the test Worker, as a public site's browser makes it. */
    publicFetch: (async (input, init) => send(new Request(input, init))) as typeof fetch,
    /** The test Worker and its env, for code that calls `worker.fetch(request, env, ctx)`. */
    worker,
    env,
    sweep: async () => {
      await worker.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' }, env(), {
        waitUntil: () => {},
        cache: {
          purge: async ({ tags }) => {
            purged.push(tags)
            return reply ? reply({ tags }) : { success: true, errors: [] }
          },
        },
      })
    },
    /** The editor's session cookie. */
    cookie: () => session(editor, editorName),
    query: <R extends Record<string, unknown>>(sql: string) => adminQuery<R>(db.url, sql),
    create: (draft: PageDocument) => call<Page>('POST', '/pages', { body: draft }),
    save: (id: string, draft: PageDocument) => saveDraft<Page>(`/pages/${id}`, draft),
    publish: (id: string) => publishDraft<Page>(`/pages/${id}`),
    saveDraft,
    publishDraft,
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

export const saveDraft = async () => {
  const find = () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Uložiť koncept')
  await expect.poll(find).toBeDefined()
  find()!.click()
}

/** The language names of the editor's content language switch ("Jazyk obsahu"), or [] without. */
export const languages = (root: ParentNode = document) =>
  [...(languageSwitch(root)?.querySelectorAll('label') ?? [])].map((l) => l.textContent?.trim())

/** The first content language switch under `root`: an editor's own, above its form. */
export const languageSwitch = (root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('[role="radiogroup"]')].find(
    (group) =>
      document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ===
      'Jazyk obsahu',
  )

/** The language the switch under `root` shows (`Angličtina`, `Taliančina`). */
export const chosenLanguage = (root: ParentNode = document) =>
  [...(languageSwitch(root)?.querySelectorAll('label') ?? [])]
    .find((label) => label.querySelector('input')?.checked)
    ?.textContent?.trim()

/** Chooses a language in the switch under `root`, as a click on its name does. */
export const chooseLanguage = (language: string, root: ParentNode = document) => {
  const label = [...(languageSwitch(root)?.querySelectorAll('label') ?? [])].find(
    (l) => l.textContent?.trim() === language,
  )
  if (!label) throw new Error(`no "${language}" in the content language switch`)
  label.querySelector('input')!.click()
}

/** The control named `name` is in view: not in a hidden language or an unselected section. */
export const shown = (name: string) =>
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.checkVisibility() === true
