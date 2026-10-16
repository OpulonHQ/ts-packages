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
    { kind: 'page', path: `/pages/${page_.id}`, field: 'locales.en.seo.title', value: 'Typed' },
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
    if (editor.kind === 'page') await page.getByRole('button', { name: 'Page settings', exact: true }).click()
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

    const publish = page.getByRole('button', { name: 'Publish', exact: true })
    await publish.focus()
    await page.keyboard.press('Enter')
    await page.getByText('Published.', { exact: true }).waitFor()
    await page.waitForTimeout(200)
    check(await publish.evaluate((button) => button === document.activeElement), `${editor.kind} focus returns to Publish after save-then-publish`)
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

  await page.goto(`${base}/admin/cms/pages/${page_.id}`)
  let restores = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/restore')) restores++
  })
  await page.getByRole('button', { name: 'View revision', exact: true }).first().click()
  await page.getByRole('button', { name: 'Restore to draft', exact: true }).click()
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Restore to draft', exact: true })
  await confirm.focus()
  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.keyboard.press('Enter')
  await restored
  await page.waitForResponse((r) => r.url().endsWith(`/pages/${page_.id}`) && r.request().method() === 'GET')
  const inDialog = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
  evidence.push({ kind: 'restore', restores, inDialog })
  check(!inDialog, 'focus does not return into the closing restore dialog')
  check(restores === 1, `a keyboard-confirmed restore runs once; Enter afterwards does not restore again (${restores})`)

  await page.goto(`${base}/admin/cms/settings`)
  const siteName = page.locator('input[name="data.siteName.en"]')
  await siteName.waitFor()
  await siteName.fill('Mine')
  const current = await call('GET', '/settings')
  await call('PUT', `/settings/draft?version=${current.version}`, { data: { siteName: { en: 'Theirs' } } })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const reload = page.getByRole('button', { name: 'Reload draft', exact: true })
  await reload.waitFor()
  await reload.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('input[name="data.siteName.en"]')?.value === 'Theirs')
  await page.waitForTimeout(200)
  const afterReload = await page.evaluate(() => ({ inForm: Boolean(document.activeElement?.closest('form')), tag: document.activeElement?.tagName }))
  evidence.push({ kind: 'reload focus', ...afterReload })
  check(afterReload.inForm, `after Reload draft, keyboard focus is in the editor form (${afterReload.tag})`)

  const usableFocus = async (label) => {
    const landed = await page.evaluate(() => {
      const element = document.activeElement
      const style = element ? getComputedStyle(element) : undefined
      return {
        tag: element?.tagName,
        inForm: Boolean(element?.closest('form')),
        ring: element?.tagName !== 'FORM' || (element.matches(':focus-visible') && style.outlineStyle !== 'none' && style.outlineWidth !== '0px'),
      }
    })
    await page.keyboard.press('Tab')
    const next = await page.evaluate(() => {
      const element = document.activeElement
      return {
        tag: element?.tagName,
        name: element?.getAttribute('name') ?? element?.textContent?.trim().slice(0, 40),
        usable: element?.tagName !== 'FORM' && Boolean(element?.closest('form')) && Boolean(element?.checkVisibility()) && !element?.closest('[aria-hidden="true"]'),
      }
    })
    evidence.push({ kind: label, landed, next })
    check(landed.inForm && landed.ring && next.usable, `${label}: focus lands in the editor form (${landed.tag}, ring ${landed.ring}) and Tab reaches a visible control (${next.tag} ${next.name})`)
  }
  const holdGet = async (path) => {
    let arrived
    let release
    const seen = new Promise((resolve) => (arrived = resolve))
    const gate = new Promise((resolve) => (release = resolve))
    await page.route(`${base}/api/cms${path}`, async (route) => {
      const response = await route.fetch()
      arrived(response.status())
      await gate
      await route.fulfill({ response })
    }, { times: 1 })
    return { seen, release }
  }
  const conflictThenReload = async (path, held) => {
    const current = await call('GET', path)
    await call('PUT', `${path}/draft?version=${current.version}`, held ?? current.draft)
    const stale = page.waitForResponse((r) => r.url().includes(`/api/cms${path}/draft?`) && r.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    check((await stale).status() === 409, `${path} stale save answers 409`)
    const reloadDraft = page.getByRole('button', { name: 'Reload draft', exact: true })
    await reloadDraft.focus()
    const { seen, release } = await holdGet(path)
    await page.keyboard.press('Enter')
    await seen
    release()
  }

  for (const editor of editors) {
    await page.goto(`${base}/admin/cms${editor.path}`)
    await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor()
    for (const tab of await page.locator('form').getByRole('tab', { name: 'Italian', exact: true }).all()) await tab.click()
    await page.locator('form input:not([type="hidden"]):not(:disabled):visible').first().fill(`/italian-${run}`)
    await conflictThenReload(editor.path)
    await page.getByRole('button', { name: 'Reload draft', exact: true }).waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    await shot(`${editor.kind}-italian-reload-focus`)
    await usableFocus(`${editor.kind} Reload draft with the Italian tab open`)
  }

  await page.goto(`${base}/admin/cms/menus/footer`)
  await page.locator('input[name="items.0.label.en"]').waitFor()
  await page.locator('input[name="items.0.label.en"]').fill('Stale label')
  const replaced = `Replaced ${run}`
  await conflictThenReload('/menus/footer', { items: [{ id: crypto.randomUUID(), label: { en: replaced }, link: { type: 'url', url: '/replaced' }, children: [] }] })
  await page.waitForFunction((label) => document.querySelector('input[name="items.0.label.en"]')?.value === label, replaced)
  await page.waitForTimeout(300)
  await usableFocus('menu Reload draft replacing the entry rows')

  await call('PUT', `/menus/footer/draft?version=${(await call('GET', '/menus/footer')).version}`, { items: [] })
  await page.goto(`${base}/admin/cms/menus/footer`)
  await page.getByRole('button', { name: 'Add entry', exact: true }).waitFor()
  await conflictThenReload('/menus/footer')
  await page.waitForTimeout(500)
  await shot('empty-menu-reload-focus')
  await usableFocus('empty menu Reload draft')

  for (const editor of editors) {
    const current = await call('GET', editor.path)
    await call('POST', `${editor.path}/publish?version=${current.version}`)
    await page.goto(`${base}/admin/cms${editor.path}`)
    await page.getByRole('button', { name: 'View revision', exact: true }).first().click()
    await page.getByRole('button', { name: 'Restore to draft', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Restore to draft', exact: true }).focus()
    const { seen, release } = await holdGet(editor.path)
    await page.keyboard.press('Enter')
    check((await seen) === 200, `${editor.kind} reload after the restore is held`)
    await page.getByRole('dialog').getByRole('button', { name: 'Restore to draft', exact: true }).waitFor({ state: 'detached' })
    await page.waitForTimeout(100)
    release()
    await page.waitForTimeout(500)
    await shot(`${editor.kind}-slow-restore-focus`)
    await usableFocus(`${editor.kind} restore whose reload outlasts the dialog`)
  }

  await writeFile(`${process.env.EVIDENCE_DIR}/editor-lock.json`, JSON.stringify(evidence, null, 2))
}
