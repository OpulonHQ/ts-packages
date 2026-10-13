// Uploads a PNG from the Media library, sets its alt text, and fetches the immutable original.
// ui.sh journeys/media.mjs email=<user with media.upload> password=<password>
import signedIn from './signed-in.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const name = `verify-${Date.now().toString(36)}.png`
  await page.goto(`${base}/admin/media`)
  await page.getByRole('table', { name: 'Media library' }).waitFor()
  const upload = page.waitForResponse((r) => r.url().endsWith('/api/media/items') && r.request().method() === 'POST')
  await page.getByLabel('Upload', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: png })
  check((await upload).status() === 200, `POST /api/media/items 200 (${name})`)
  const details = page.getByRole('dialog', { name: 'Media details' })
  await details.waitFor()
  await shot('uploaded')

  await details.getByRole('textbox', { name: 'Alt text' }).fill('A single verify pixel')
  const patch = page.waitForResponse((r) => /\/api\/media\/items\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await details.getByRole('button', { name: 'Save' }).click()
  check((await patch).status() === 200, 'PATCH /api/media/items/<id> 200')
  await details.getByRole('status').filter({ hasText: 'Saved.' }).waitFor()
  await shot('alt-saved')

  const href = await details.getByRole('link', { name: 'Open original' }).getAttribute('href')
  const original = await page.request.get(new URL(href, base).toString())
  check(
    original.status() === 200 && /immutable/.test(original.headers()['cache-control'] ?? ''),
    `GET ${new URL(href, base).pathname} ${original.status()} ${original.headers()['content-type']}, ${original.headers()['cache-control']}`,
  )
  await page.keyboard.press('Escape')
  await page.getByRole('cell', { name }).first().waitFor()
  await shot('library-row')
}
