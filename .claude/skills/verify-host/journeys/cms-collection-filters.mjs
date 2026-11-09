import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const api = async (method, path, data) => {
    const result = await page.request.fetch(`${base}/api/cms${path}`, {
      method,
      headers: { Origin: base },
      ...(data === undefined ? {} : { data }),
    })
    check(result.ok(), `${method} ${path} ${result.status()}`)
    return result.json()
  }
  const category = async (name) =>
    (await api('POST', '/collections/categories/items', { locales: {}, data: { name: { en: name } } }))
      .id
  const news = await category(`News ${run}`)
  const law = await category(`Law ${run}`)
  const titles = [`${run} A`, `${run} B`, `${run} C`]
  for (const [title, data] of [
    [titles[0], { categories: [news] }],
    [titles[1], { categories: [law, news], kind: 'guide' }],
    [titles[2], {}],
  ])
    await api('POST', '/collections/posts/items', { locales: {}, data: { title: { en: title }, ...data } })

  const visible = async (expected) => {
    for (const title of titles) {
      const row = page.getByRole('row').filter({ hasText: title })
      if (expected.includes(title)) await row.waitFor()
      else await row.waitFor({ state: 'detached' })
    }
    check(true, `list shows ${expected.join(', ') || 'none'} of ${titles.join(', ')}`)
  }
  const pick = async (filter, option) => {
    const answer = page.waitForResponse((r) => r.url().includes('/api/cms/collections/posts/items?') && r.url().includes(`filter=${filter === 'Kind' ? 'kind' : 'categories'}`))
    await page.locator(`[aria-haspopup="listbox"][aria-label="${filter}"]`).click()
    await page.getByRole('option', { name: option, exact: true }).click()
    const response = await answer
    check(response.status() === 200, `${filter} = ${option}: GET ${new URL(response.url()).search} ${response.status()}`)
  }

  await page.goto(`${base}/admin/cms/collections/posts`)
  await page.getByRole('textbox', { name: 'Search' }).fill(run)
  await visible(titles)
  await shot('posts-unfiltered')
  await pick('Categories', `News ${run}`)
  await visible([titles[0], titles[1]])
  await shot('posts-by-category')
  await pick('Kind', 'Guide')
  await visible([titles[1]])
  await shot('posts-by-category-and-kind')
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('textbox', { name: 'Search' }).fill(run)
  await visible(titles)
  await shot('posts-reset')

  const refused = await page.request.get(`${base}/api/cms/collections/posts/items?filter=title:x`, {
    headers: { Origin: base },
  })
  check(refused.status() === 400, `filter on an unnamed field: ${refused.status()} ${await refused.text()}`)

  await page.getByRole('link', { name: 'Categories' }).first().click()
  await page.getByRole('row').filter({ hasText: `Law ${run}` }).waitFor()
  check((await page.locator('section [aria-haspopup="listbox"]').count()) === 0, 'categories list shows no filter')
  await shot('categories-no-filters')
}
