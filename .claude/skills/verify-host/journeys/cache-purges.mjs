import signedIn from './signed-in.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export default async (ctx) => {
  const { page, base, shot, args, check } = ctx
  if (args.mediaOnly === 'yes') await page.context().clearCookies()
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const name = `purge-${run}.png`
  const path = `/purge-${run}`
  await page.goto(`${base}/admin/media`)
  await page.getByRole('table', { name: 'Media library' }).waitFor()
  const upload = page.waitForResponse(
    (r) => r.url().endsWith('/api/media/items') && r.request().method() === 'POST',
  )
  await page.getByLabel('Upload', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: png,
  })
  const uploaded = await upload
  check(uploaded.status() === 200, 'media uploaded through admin')
  const media = await uploaded.json()
  const details = page.getByRole('dialog', { name: 'Media details' })
  await details.waitFor()
  const created = await page.request.post(`${base}/api/cms/pages`, {
    headers: { origin: base },
    data: {
      locales: {
        en: {
          path,
          available: true,
          seo: { title: `Purge ${run}`, description: '', image: media.id, noindex: false },
        },
      },
      sections: [
        {
          id: crypto.randomUUID(),
          type: 'hero',
          data: { title: { en: 'Purge proof' }, image: media.id },
        },
      ],
    },
  })
  check(created.status() === 200, 'page created through composed API')
  const document = await created.json()
  const published = await page.request.post(`${base}/api/cms/pages/${document.id}/publish`, {
    headers: { origin: base },
  })
  check(published.status() === 200, 'page published through composed API')
  const before = await page.request.get(`${base}/api/cms/resolve?path=${path}`)
  const tags = (before.headers()['cache-tag'] ?? '').split(',')
  check(tags.includes(`media:${media.id}`), 'resolved answer carries the media Cache-Tag')
  if (args.mediaOnly === 'yes') {
    const me = await (await page.request.get(`${base}/api/me`)).json()
    const permissions = ['media.view', 'media.upload', 'media.archive']
    const createdRole = await page.request.post(`${base}/api/users/roles`, {
      headers: { origin: base },
      data: { name: `Media purge proof ${run}`, permissions },
    })
    check(createdRole.status() === 200, 'create media editor role through admin API')
    const role = await createdRole.json()
    const manager = await page.context().browser().newContext()
    const signed = await manager.request.post(`${base}/api/users/auth/sign-in`, {
      headers: { origin: base },
      data: { email: args.managerEmail, password: args.managerPassword },
    })
    check(signed.status() === 200, 'sign in the other fixture admin to assign editor roles')
    const assigned = await manager.request.put(`${base}/api/users/users/${me.user.id}/roles`, {
      headers: { origin: base },
      data: { roleIds: [role.id] },
    })
    check(
      assigned.status() === 204,
      `assign media-only role through admin API (${assigned.status()}, ${await assigned.text()})`,
    )
    await manager.close()
    const narrowed = await (await page.request.get(`${base}/api/me`)).json()
    check(
      narrowed.permissions.length === 3 &&
        narrowed.permissions.every((key) => permissions.includes(key)),
      'current editor has only media permissions',
    )
    check(
      (await page.request.get(`${base}/api/cms/pages`)).status() === 403,
      'media editor cannot read CMS admin pages',
    )
    check(
      (await page.request.get(`${base}/api/cache-purges`)).status() === 200,
      'media editor can read authorized core purge status',
    )
    await page.reload()
    await page.getByRole('table', { name: 'Media library' }).waitFor()
    await page.getByRole('row').filter({ hasText: name }).click()
    await details.waitFor()
  }
  await details.getByRole('textbox', { name: 'Alt text' }).fill(`Purge proof ${run}`)
  await details.getByRole('textbox', { name: 'Caption', exact: true }).fill(`Caption ${run}`)
  await shot('metadata-before-save')
  const patch = page.waitForResponse(
    (r) => r.url().endsWith(`/api/media/items/${media.id}`) && r.request().method() === 'PATCH',
  )
  await details.getByRole('button', { name: 'Save', exact: true }).click()
  check((await patch).status() === 200, 'metadata edit succeeds even when purge is refused')
  await details.getByRole('status').filter({ hasText: 'Saved.' }).waitFor()
  await shot('metadata-saved')
  const after = await page.request.get(`${base}/api/cms/resolve?path=${path}`)
  const body = await after.json()
  check(
    body.sections[0].data.image.alt === `Purge proof ${run}`,
    'fresh Read API resolves edited alt text',
  )
  if (args.mediaOnly !== 'yes') await page.goto(`${base}/admin${args.route ?? '/cms/pages'}`)
  if (args.failure === 'yes') {
    const notice = page
      .getByRole('status')
      .filter({
        hasText: args.notice ?? 'Live site may show the previous version',
      })
      .first()
    await notice.waitFor()
    const contrast = await notice.evaluate((element) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      const sample = (color) => {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const title = element.querySelector('[class*="font-medium"]') ?? element
      const luminance = (rgb) =>
        rgb
          .map((channel) => {
            const value = channel / 255
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
          })
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
      const foreground = luminance(sample(getComputedStyle(title).color))
      const background = luminance(sample(getComputedStyle(element).backgroundColor))
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    check(contrast >= 4.5, `warning text contrast ${contrast.toFixed(2)}:1 meets AA`)
  } else {
    await page.getByRole('table').first().waitFor()
  }
  await shot(args.failure === 'yes' ? 'purge-failure-visible' : 'purge-success')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('purge-mobile')
  if (args.mediaOnly === 'yes') {
    await page.keyboard.press('Escape')
    await page.getByRole('table', { name: 'Media library' }).waitFor()
    await page
      .getByRole('status')
      .filter({ hasText: 'Live site may show the previous version' })
      .waitFor()
    await shot('media-library-purge-warning')
  }
}
