import { writeFile } from 'node:fs/promises'
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const locale = (title) => ({ path: `/conflict-${run}`, available: true, seo: { title, description: '', image: null, noindex: false } })
  const journeys = [
    { kind: 'page', create: '/pages', path: (id) => `/pages/${id}`, first: { locales: { en: locale('First title') }, sections: [] }, second: { locales: { en: locale('Second title') }, sections: [] }, input: 'locales.en.seo.title', restored: 'First title' },
    { kind: 'item', create: '/collections/posts/items', path: (id) => `/items/${id}`, first: { locales: {}, data: { title: { en: 'First conflict item' } } }, second: { locales: {}, data: { title: { en: 'Second conflict item' } } }, input: 'data.title.en', restored: 'First conflict item' },
    { kind: 'settings', path: () => '/settings', first: { data: { siteName: { en: 'First conflict site' } } }, second: { data: { siteName: { en: 'Second conflict site' } } }, input: 'data.siteName.en', restored: 'First conflict site' },
    { kind: 'menu', path: () => '/menus/footer', first: { items: [] }, second: { items: [{ id: crypto.randomUUID(), label: { en: 'Second conflict link' }, link: { type: 'url', url: '/second' }, children: [] }] } },
  ]
  const call = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} ${path} ${response.status()}`)
    return response.json()
  }
  const evidence = []
  for (const journey of journeys) {
    const created = journey.create ? await call('POST', journey.create, journey.first) : undefined
    const path = journey.path(created?.id)
    const loaded = created ?? (await call('GET', path))
    const saved = await call('PUT', `${path}/draft?version=${loaded.version}`, journey.first)
    const first = await call('POST', `${path}/publish?version=${saved.version}`)
    const edited = await call('PUT', `${path}/draft?version=${first.version}`, journey.second)
    const second = await call('POST', `${path}/publish?version=${edited.version}`)

    await page.goto(`${base}/admin/cms${path}`)
    await page.getByRole('button', { name: 'Publish', exact: true }).waitFor()
    if (journey.input) await page.locator(`input[name="${journey.input}"]`).fill(`Stale ${journey.kind} edit`)
    await shot(`${journey.kind}-stale-editor-typed`)

    const restored = await call('POST', `${path}/revisions/${first.publishedRevisionId}/restore?version=${second.version}`)
    check(JSON.stringify(restored.draft) === JSON.stringify(first.draft), `${journey.kind} other editor restored revision 1 to draft`)

    const requests = []
    const listener = (r) => { if (r.url().includes(`/api/cms${path}/`)) requests.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search} ${r.status()}`) }
    page.on('response', listener)
    const saving = page.waitForResponse((r) => r.url().includes(`${path}/draft`) && r.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const saveStatus = (await saving).status()
    await page.waitForTimeout(500)
    page.off('response', listener)
    const after = await call('GET', path)
    const row = { kind: journey.kind, path, requests, saveStatus, draftAfter: after.draft, publishedAfter: after.published, restoredDraft: first.draft, secondPublished: second.published }
    evidence.push(row)
    await writeFile(`${process.env.EVIDENCE_DIR}/conflict-results.json`, JSON.stringify(evidence, null, 2))
    await shot(`${journey.kind}-after-stale-publish`)

    check(saveStatus === 409, `${journey.kind} stale save-then-publish refused with 409 (got ${saveStatus})`)
    check(!requests.some((r) => r.startsWith('POST') && r.includes('/publish')), `${journey.kind} no publish request after the refused save`)
    check(JSON.stringify(after.draft) === JSON.stringify(first.draft), `${journey.kind} restored draft kept`)
    check(JSON.stringify(after.published) === JSON.stringify(second.published), `${journey.kind} published unchanged`)
    const alert = page.getByRole('alert').filter({ hasText: 'changed' })
    await alert.waitFor()
    if (journey.input) check((await page.locator(`input[name="${journey.input}"]`).inputValue()) === `Stale ${journey.kind} edit`, `${journey.kind} unsaved input still on screen`)
    await alert.scrollIntoViewIfNeeded()
    await shot(`${journey.kind}-conflict-message`)

    await page.getByRole('button', { name: 'Reload draft', exact: true }).click()
    if (journey.input) await page.waitForFunction(({ input, value }) => document.querySelector(`input[name="${input}"]`)?.value === value, { input: journey.input, value: journey.restored })
    else await page.waitForFunction(() => document.querySelectorAll('form input').length === 0)
    await shot(`${journey.kind}-reloaded`)
    const publishing = page.waitForResponse((r) => r.url().includes(`${path}/publish`) && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    check((await publishing).status() === 200, `${journey.kind} publish after reload 200`)
    const final = await call('GET', path)
    check(JSON.stringify(final.published) === JSON.stringify(first.draft), `${journey.kind} reloaded editor publishes the restored draft`)
  }
}
