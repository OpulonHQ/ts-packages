import signedIn from './signed-in.mjs'

const onDemand = /^(DataTable|RichTextControl|prosemirror)-/

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const scripts = []
  page.on('request', (request) => {
    if (/\/admin\/assets\/[^/]+\.js$/.test(request.url())) scripts.push(request.url().split('/').pop())
  })
  let start = 0
  const loaded = (pattern) => scripts.slice(start).filter((name) => pattern.test(name))
  const open = async (path) => {
    start = scripts.length
    await page.goto(`${base}${path}`)
  }

  await open('/admin/')
  await page.getByRole('heading', { name: 'Dashboard' }).first().waitFor()
  check(loaded(onDemand).length === 0, `dashboard: ${loaded(/./).length} scripts, none of DataTable, RichTextControl, prosemirror`)
  await shot('dashboard')

  await open('/admin/cms/collections/categories')
  await page.getByRole('button', { name: 'New item' }).click()
  await page.waitForURL(/\/admin\/cms\/items\/[0-9a-f-]{36}/)
  await page.getByRole('textbox', { name: 'Name' }).waitFor()
  check(loaded(/^(RichTextControl|prosemirror)-/).length === 0, 'categories item (no rich text field): editor not loaded')

  await open('/admin/cms/collections/posts')
  await page.getByRole('button', { name: 'New item' }).click()
  await page.waitForURL(/\/admin\/cms\/items\/[0-9a-f-]{36}/)
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type('Loaded on demand')
  await page.getByText('Loaded on demand').waitFor()
  check(
    loaded(/^RichTextControl-/).length > 0 && loaded(/^prosemirror-/).length > 0,
    `posts item: rich text editor loaded on demand (${loaded(/^(RichTextControl|prosemirror)-/).join(', ')}) and accepts typing`,
  )
  await shot('posts-item-editor')

  await page.route(/\/RichTextControl-[^/]+\.js$/, (route) => route.abort())
  await open(page.url().replace(base, ''))
  const failed = page.getByRole('alert').filter({ hasText: 'The editor could not be loaded' })
  await failed.waitFor()
  check(
    (await failed.getByRole('button', { name: 'Reload page' }).count()) === 1 &&
      (await page.locator('[contenteditable="true"]').count()) === 0,
    'posts item with the editor download blocked: alert with a Reload page action, no editor',
  )
  await shot('posts-item-editor-failed')
  await page.unroute(/\/RichTextControl-[^/]+\.js$/)

  await open('/admin/emails/templates/users.invitation')
  await page.locator('[contenteditable="true"]').first().waitFor()
  check(true, 'email template editor renders its rich text body')
  await shot('email-template-editor')

  await open('/admin/media')
  await page.getByRole('table').waitFor()
  check(loaded(/^DataTable-/).length > 0, `media library: DataTable loaded on demand (${loaded(/^DataTable-/)[0]})`)
  await shot('media-library')
}
