import type { Page } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

const hero = (title: string) => section('hero', { title: { en: title } })

test('publishing copies the draft, records a revision and an audit event, then purges', async () => {
  const created = (await host.create(page({ en: '/pricing', it: '/prezzi' }, [hero('Prices')])))
    .body
  const purges = host.purged.length

  const { status, body } = await host.publish(created.id)
  expect(status).toBe(200)
  expect(body).toMatchObject({ status: 'published', published: body.draft })
  expect(body.publishedRevisionId).toEqual(expect.any(String))
  expect(host.purged.slice(purges)).toEqual([[`cms:page:${created.id}`, 'cms:routes']])

  const [revision] = await host.query(
    `select reason, created_by_name, document from cms.revision where id = '${body.publishedRevisionId}'`,
  )
  expect(revision).toMatchObject({
    reason: 'publish',
    created_by_name: 'Eda Editor',
    document: body.draft,
  })

  const events = await host.query(
    `select action, subject_id, context from core.audit_event where subject_id = '${created.id}'`,
  )
  expect(events).toEqual([
    {
      action: 'cms.page.published',
      subject_id: created.id,
      context: { revisionId: body.publishedRevisionId },
    },
  ])
  // Published paths per available locale, for routing.
  expect(
    await host.query(
      `select locale, path from cms.path where document_id = '${created.id}' order by locale`,
    ),
  ).toEqual([
    { locale: 'en', path: '/pricing' },
    { locale: 'it', path: '/prezzi' },
  ])
})

test('editing a published page changes only the draft until the next publish', async () => {
  const created = (await host.create(page({ en: '/news' }, [hero('Old')]))).body
  const first = (await host.publish(created.id)).body

  const edited = (await host.save(created.id, page({ en: '/news' }, [hero('New')]))).body
  expect(edited.status).toBe('changed')
  expect(edited.published).toEqual(first.published)

  const second = (await host.publish(created.id)).body
  expect(second.status).toBe('published')
  expect(second.publishedRevisionId).not.toBe(first.publishedRevisionId)
  expect(second.published?.sections[0]?.data).toEqual({ title: { en: 'New' } })
  const revisions = await host.query(
    `select id from cms.revision where document_id = '${created.id}'`,
  )
  expect(revisions).toHaveLength(2)
})

test('publishing needs required fields in the default locale; drafts do not', async () => {
  const created = await host.create(
    page({ en: '/draft-only' }, [section('hero', { title: { it: 'Solo' } })]),
  )
  expect(created.status).toBe(200)
  const refused = await host.publish(created.body.id)
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ message: 'Section 1 (Hero): "Title" is required in en.' })
})

test('unpublishing withdraws the page and is audited', async () => {
  const created = (await host.create(page({ en: '/gone' }, [hero('Bye')]))).body
  await host.publish(created.id)
  const purges = host.purged.length

  const { body } = await host.call<Page>('POST', `/pages/${created.id}/unpublish`)
  expect(body).toMatchObject({ status: 'draft', published: null, publishedRevisionId: null })
  expect(host.purged.slice(purges)).toEqual([[`cms:page:${created.id}`, 'cms:routes']])
  expect(await host.query(`select * from cms.path where document_id = '${created.id}'`)).toEqual([])
  const actions = await host.query<{ action: string }>(
    `select action from core.audit_event where subject_id = '${created.id}' order by id`,
  )
  expect(actions.map((a) => a.action)).toEqual(['cms.page.published', 'cms.page.unpublished'])
})

test('a published path blocks other pages from publishing it', async () => {
  const a = (await host.create(page({ en: '/events' }))).body
  await host.publish(a.id)
  // A moves away in its draft only; its published path still holds /events.
  await host.save(a.id, page({ en: '/events-old' }))
  const b = await host.create(page({ en: '/events' }))
  expect(b.status).toBe(409)
})

test('drafts are not audited and each action needs its permission', async () => {
  const created = (await host.create(page({ en: '/quiet' }))).body
  expect(
    await host.query(`select * from core.audit_event where subject_id = '${created.id}'`),
  ).toEqual([])

  const viewer = ['cms.pages.view']
  expect((await host.call('GET', '/pages', { as: viewer })).status).toBe(200)
  expect((await host.call('POST', '/pages', { as: viewer, body: page({ en: '/x' }) })).status).toBe(
    403,
  )
  expect(
    (await host.publishDraft(`/pages/${created.id}`, { as: ['cms.pages.view', 'cms.pages.edit'] }))
      .status,
  ).toBe(403)
  expect((await host.call('GET', '/pages', { as: null })).status).toBe(401)
})
