import { writeFile } from 'node:fs/promises'
import { Client } from 'pg'
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const locale = { path: `/revisions-${run}`, available: true, seo: { title: 'First revision', description: '', image: null, noindex: false } }
  const journeys = [
    { kind: 'page', create: '/pages', path: (id) => `/pages/${id}`, route: (id) => `/pages/${id}`, first: { locales: { en: locale }, sections: [] }, second: { locales: { en: { ...locale, seo: { ...locale.seo, title: 'Second revision' } } }, sections: [] }, input: 'locales.en.seo.title', expected: 'First revision' },
    { kind: 'item', create: '/collections/posts/items', path: (id) => `/items/${id}`, route: (id) => `/items/${id}`, first: { locales: {}, data: { title: { en: 'First revision item' } } }, second: { locales: {}, data: { title: { en: 'Second revision item' } } }, input: 'data.title.en', expected: 'First revision item' },
    { kind: 'settings', path: () => '/settings', route: () => '/settings', first: { data: { siteName: { en: 'First revision site' } } }, second: { data: { siteName: { en: 'Second revision site' } } }, input: 'data.siteName.en', expected: 'First revision site' },
    { kind: 'menu', path: () => '/menus/footer', route: () => '/menus/footer', first: { items: [] }, second: { items: [{ id: crypto.randomUUID(), label: { en: 'Second revision menu' }, link: { type: 'url', url: '/second' }, children: [] }] } },
  ]
  const evidence = []
  const call = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} ${path} ${response.status()}`)
    return response.json()
  }
  for (const journey of journeys) {
    const created = journey.create ? await call('POST', journey.create, journey.first) : undefined
    const path = journey.path(created?.id)
    if (!created) await call('PUT', `${path}/draft`, journey.first)
    const first = await call('POST', `${path}/publish`)
    await call('PUT', `${path}/draft`, journey.second)
    const second = await call('POST', `${path}/publish`)
    await page.goto(`${base}/admin/cms${journey.route(created?.id)}`)
    await page.getByRole('heading', { name: 'Revision history', exact: true }).waitFor()
    const views = page.getByRole('button', { name: 'View revision', exact: true })
    await views.nth(1).waitFor()
    await page.getByRole('heading', { name: 'Revision history', exact: true }).scrollIntoViewIfNeeded()
    await shot(`${journey.kind}-history`)
    await views.nth(1).click()
    await page.getByRole('button', { name: 'Restore to draft', exact: true }).waitFor()
    if (journey.input) {
      await page.waitForFunction(({ input, expected }) => document.querySelector(`input[name="revision.${input}"]`)?.value === expected, { input: journey.input, expected: journey.expected })
      await page.locator(`input[name="revision.${journey.input}"]`).scrollIntoViewIfNeeded()
    } else await page.getByRole('button', { name: 'Restore to draft', exact: true }).scrollIntoViewIfNeeded()
    await shot(`${journey.kind}-snapshot`)
    await page.getByRole('button', { name: 'Restore to draft', exact: true }).click()
    await shot(`${journey.kind}-confirmation`)
    const restoring = page.waitForResponse((r) => r.url().endsWith(`/revisions/${first.publishedRevisionId}/restore`) && r.request().method() === 'POST')
    await page.getByRole('dialog').getByRole('button', { name: 'Restore to draft', exact: true }).click()
    check((await restoring).status() === 200, `${journey.kind} restore through UI 200`)
    await page.getByRole('status').filter({ hasText: 'Revision restored to draft.' }).first().waitFor()
    const stored = await call('GET', path)
    check(JSON.stringify(stored.draft) === JSON.stringify(first.draft), `${journey.kind} draft restored`)
    check(JSON.stringify(stored.published) === JSON.stringify(second.published) && stored.publishedRevisionId === second.publishedRevisionId, `${journey.kind} published snapshot unchanged`)
    if (journey.input) await page.waitForFunction(({ input, expected }) => document.querySelector(`input[name="${input}"]`)?.value === expected, { input: journey.input, expected: journey.expected })
    else await page.waitForFunction(() => document.querySelectorAll('form input').length === 0)
    if (journey.input) await page.locator(`input[name="${journey.input}"]`).scrollIntoViewIfNeeded()
    else await page.locator('form').scrollIntoViewIfNeeded()
    await shot(`${journey.kind}-restored-draft`)
    const published = page.waitForResponse((r) => r.url().endsWith(`${path}/publish`) && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    check((await published).status() === 200, `${journey.kind} normal publish 200`)
    await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()
    const after = await call('GET', path)
    check(JSON.stringify(after.published) === JSON.stringify(first.draft), `${journey.kind} separate publish promotes restored draft`)
    await shot(`${journey.kind}-published`)
    evidence.push({ kind: journey.kind, path, firstRevisionId: first.publishedRevisionId, secondRevisionId: second.publishedRevisionId, restoredDraft: stored.draft, publishedDuringRestore: stored.published, publishedAfterSeparatePublish: after.published })
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL_DIRECT })
  await db.connect()
  try {
    const audit = await db.query("select action, subject_type, subject_id, context from core.audit_event where action like 'cms.%.restored' order by id")
    for (const row of evidence) check(audit.rows.some((event) => event.action === `cms.${row.kind}.restored` && event.context.revisionId === row.firstRevisionId), `${row.kind} restore audit persisted in Postgres`)
    await writeFile(`${process.env.EVIDENCE_DIR}/audit-results.json`, JSON.stringify(audit.rows, null, 2))
    const anonymous = await page.context().browser().newContext()
    try {
      for (const row of evidence) {
        const denied = await anonymous.request.post(`${base}/api/cms${row.path}/revisions/${row.firstRevisionId}/restore`, { headers: { Origin: base } })
        check(denied.status() === 401, `${row.kind} signed-out restore receives 401`)
      }
    } finally { await anonymous.close() }
  } finally { await db.end() }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/admin/cms/settings`)
  await page.getByRole('heading', { name: 'Revision history', exact: true }).waitFor()
  await page.getByRole('button', { name: 'View revision', exact: true }).first().waitFor()
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'revision history fits phone viewport')
  await page.getByRole('heading', { name: 'Revision history', exact: true }).scrollIntoViewIfNeeded()
  await shot('settings-phone')
  await writeFile(`${process.env.EVIDENCE_DIR}/api-results.json`, JSON.stringify(evidence, null, 2))
}
