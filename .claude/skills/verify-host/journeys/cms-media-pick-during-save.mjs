// Uploads a Cover through the item editor's picker and returns it while a save, a publish (held
// on its save, then on its publish) or a revision restore is still in flight; the pick must
// survive the response and save with the next draft.
// ui.sh journeys/cms-media-pick-during-save.mjs [only=save|publish-held-save|publish-held-publish|restore]
import signedIn from './signed-in.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export default async (ctx) => {
  const { page, base, shot, args, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const api = async (method, path, data) => {
    const response = await page.request.fetch(`${base}/api${path}`, { method, data, headers: { Origin: base } })
    check(response.status() === 200, `${method} ${path} ${response.status()}`)
    return response.json()
  }
  const hold = async (method, pattern) => {
    let arrived
    let release
    const held = new Promise((resolve) => (arrived = resolve))
    const gate = new Promise((resolve) => (release = resolve))
    let used = false
    // No `times: 1`: once the last route expires Playwright stops intercepting and lets every held request go.
    await page.route(pattern, async (route) => {
      if (used || route.request().method() !== method) return route.fallback()
      used = true
      arrived()
      await gate
      await route.continue()
    })
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`no ${method} ${pattern}`)), 10000))
    return { held: Promise.race([held, timeout]), release }
  }
  const cases = [
    { name: 'save', button: 'Save draft', held: ['PUT', '**/draft?*'], done: 'Draft saved.' },
    { name: 'publish-held-save', button: 'Publish', held: ['PUT', '**/draft?*'], done: 'Published.' },
    { name: 'publish-held-publish', button: 'Publish', held: ['POST', '**/publish?*'], done: 'Published.' },
    { name: 'restore', button: 'Restore to draft', held: ['POST', '**/restore*'], done: 'Revision restored to draft.' },
  ]

  for (const c of cases.filter((c) => !args.only || c.name === args.only)) {
    const item = await api('POST', '/cms/collections/posts/items', { locales: {}, data: { title: { en: `Cover ${c.name}` } } })
    await api('POST', `/cms/items/${item.id}/publish?version=${item.version}`)
    await page.goto(`${base}/admin/cms/items/${item.id}`)
    const cover = page.locator('form div.space-y-2').filter({ has: page.getByText('Cover', { exact: true }) })
    await cover.getByRole('button', { name: 'Choose media' }).waitFor()
    if (c.name === 'restore') {
      await page.getByRole('button', { name: 'View revision', exact: true }).first().click()
      await page.getByRole('button', { name: 'Restore to draft', exact: true }).waitFor()
    }

    const filename = `cover-${c.name}-${run}.png`
    const upload = await hold('POST', '**/api/media/items')
    await cover.getByRole('button', { name: 'Choose media' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose media' })
    await picker.getByLabel('Upload', { exact: true }).setInputFiles({ name: filename, mimeType: 'image/png', buffer: png })
    await upload.held
    await picker.getByRole('button', { name: 'Close' }).click()
    await picker.waitFor({ state: 'hidden' })

    const action = await hold(...c.held)
    await page.getByRole('button', { name: c.button, exact: true }).first().click()
    if (c.name === 'restore') await page.getByRole('dialog').getByRole('button', { name: 'Restore to draft', exact: true }).click()
    await action.held
    const response = page.waitForResponse((r) => r.url().endsWith('/api/media/items') && r.request().method() === 'POST')
    upload.release()
    const uploaded = await (await response).json()
    await page.waitForTimeout(300)
    await cover.scrollIntoViewIfNeeded()
    await shot(`${c.name}-upload-returned-while-held`)
    const whileHeld = await cover.textContent()
    action.release()
    await page.getByText(c.done, { exact: true }).first().waitFor()
    await page.waitForTimeout(300)
    await cover.scrollIntoViewIfNeeded()
    await shot(`${c.name}-after-response`)
    const after = await cover.textContent()
    const unsaved = (await api('GET', `/cms/items/${item.id}`)).draft.data.cover
    check(
      after?.includes(filename) && unsaved === undefined,
      `${c.name}: held ${c.held.join(' ')}; upload ${uploaded.id} returned meanwhile; Cover shows "${after}" after "${c.done}", stored draft cover ${unsaved} (picker while held: "${whileHeld}")`,
    )

    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Draft saved.', { exact: true }).waitFor()
    const saved = (await api('GET', `/cms/items/${item.id}`)).draft.data.cover
    check(saved === uploaded.id, `${c.name}: the next Save stores the picked cover (${saved})`)
    await page.unrouteAll({ behavior: 'wait' })
  }
}
