import { writeFile } from 'node:fs/promises'
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const call = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api/cms${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} ${path} ${response.status()}`)
    return response.json()
  }
  const hero = { id: crypto.randomUUID(), type: 'hero', data: { title: { en: 'Lock hero' } } }
  const page_ = await call('POST', '/pages', { locales: { en: { path: `/lock-${run}`, available: false, seo: { title: 'Lock', description: '', image: null, noindex: false } } }, sections: [hero] })
  const item = await call('POST', '/collections/posts/items', { locales: {}, data: { title: { en: 'Lock item' } } })
  const menu = await call('GET', '/menus/footer')
  await call('PUT', `/menus/footer/draft?version=${menu.version}`, { items: [{ id: crypto.randomUUID(), label: { en: 'Lock link' }, link: { type: 'url', url: '/lock' }, children: [] }] })
  const editors = [
    { kind: 'page', path: `/pages/${page_.id}`, field: `locales.en.path`, value: `/lock-${run}-typed` },
    { kind: 'item', path: `/items/${item.id}`, field: 'data.title.en', value: 'Typed' },
    { kind: 'settings', path: '/settings', field: 'data.siteName.en', value: 'Typed' },
    { kind: 'menu', path: '/menus/footer', field: 'items.0.label.en', value: 'Typed' },
  ]

  const holdSave = async (path) => {
    let arrived
    let release
    const held = new Promise((resolve) => (arrived = resolve))
    const gate = new Promise((resolve) => (release = resolve))
    const pattern = `**/api/cms${path}/draft?*`
    await page.route(pattern, async (route) => {
      const response = await route.fetch()
      arrived(response.status())
      await gate
      await route.fulfill({ response })
    }, { times: 1 })
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`no save request for ${path}`)), 10000))
    return { held: Promise.race([held, timeout]), release }
  }
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName)
  const evidence = []

  for (const editor of editors) {
    await page.goto(`${base}/admin/cms${editor.path}`)
    const field = page.locator(`input[name="${editor.field}"]`)
    await field.waitFor()
    await field.fill(editor.value)
    const save = await holdSave(editor.path)
    await field.focus()
    await page.evaluate(() => document.querySelector('form')?.requestSubmit())
    check((await save.held) === 200, `${editor.kind} submitting with focus in the field saves the draft`)
    const pending = await active()
    save.release()
    await page.getByText('Draft saved.', { exact: true }).waitFor()
    const after = await active()
    await page.keyboard.type(' continued')
    const value = await field.inputValue()
    evidence.push({ kind: editor.kind, pending, after, value })
    await shot(`${editor.kind}-focus-after-save`)
    check(value === `${editor.value} continued`, `${editor.kind} typing right after the save reaches the field (focus ${pending} -> ${after}, value "${value}")`)
  }

  await page.goto(`${base}/admin/cms/items/${item.id}`)
  const rich = page.locator('.tiptap').first()
  await rich.waitFor()
  await rich.click()
  await page.keyboard.type('Rich')
  const richSave = await holdSave(`/items/${item.id}`)
  await page.evaluate(() => document.querySelector('form')?.requestSubmit())
  await richSave.held
  richSave.release()
  await page.getByText('Draft saved.', { exact: true }).waitFor()
  await page.keyboard.type(' more')
  const richText = await rich.textContent()
  evidence.push({ kind: 'rich text', value: richText })
  check(richText?.includes('Rich more'), `rich text gets focus back after the save ("${richText}")`)

  await page.goto(`${base}/admin/cms/pages/${page_.id}`)
  const remove = page.getByRole('button', { name: 'Remove section', exact: true })
  await remove.waitFor()
  const sections = () => page.getByRole('button', { name: 'Remove section', exact: true }).count()
  const before = await sections()
  const sectionSave = await holdSave(`/pages/${page_.id}`)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await sectionSave.held
  await remove.click({ force: true, timeout: 2000 }).catch(() => {})
  const during = await sections()
  await shot('page-remove-section-while-saving')
  sectionSave.release()
  await page.getByText('Draft saved.', { exact: true }).waitFor()
  evidence.push({ kind: 'page sections', before, during })
  check(during === before, `Remove section does nothing while the save is in flight (${before} -> ${during})`)

  await writeFile(`${process.env.EVIDENCE_DIR}/editor-lock.json`, JSON.stringify(evidence, null, 2))
}
