import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  await page.goto(`${base}/admin/demo/kit`)
  await page.getByRole('table', { name: 'Tasks' }).waitFor()
  const value = (name) => page.locator(`[data-value="${name}"]`)
  const shows = async (name, text) => {
    await value(name).filter({ hasText: text }).waitFor()
    check(true, `${name} = ${text}`)
  }
  const bar = page.getByRole('region', { name: 'Unsaved changes' })
  check((await bar.count()) === 0, 'no Unsaved changes bar before an edit')
  await shot('empty')

  const price = page.getByRole('textbox', { name: 'Price' })
  await price.focus()
  await page.keyboard.type('12,50')
  await shows('price', '1250')
  await bar.waitFor()
  check(true, 'typing an amount raises the Unsaved changes bar')
  await price.fill('1.234')
  await page.getByText('Enter an amount with up to 2 decimal places.').waitFor()
  await shows('price', '1250')
  check((await price.getAttribute('aria-invalid')) === 'true', 'a third decimal is refused, the input is marked invalid and the amount stays 1250')
  await shot('money-refused')
  await price.fill('1.15')
  await shows('price', '115')

  await page.getByLabel('Publish at').fill('2026-12-24T09:30')
  await shows('publishAt', await page.evaluate(() => new Date(2026, 11, 24, 9, 30).toISOString()))

  const searches = []
  page.on('response', (r) => r.url().includes('/api/demo/notes/search') && searches.push(`${r.status()} ${new URL(r.url()).search}`))
  const note = page.getByLabel('Note', { exact: true })
  await note.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'hello from demo' }).waitFor()
  await page.keyboard.type('zzz')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByText('No records found').waitFor()
  await shows('noteId', 'none')
  check(true, 'ArrowDown and Enter right after typing a new term pick no option of the previous term')
  await shot('relation-no-match')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await page.keyboard.type('HEL')
  await page.getByRole('option', { name: 'hello from demo' }).waitFor()
  await shot('relation-found')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await shows('noteId', '1')
  await page.getByRole('button', { name: 'Clear Note' }).focus()
  await page.keyboard.press('Enter')
  await shows('noteId', 'none')
  check(true, 'the Clear Note button clears the relation by keyboard')
  await note.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'hello from demo' }).click()
  await shows('noteId', '1')
  check(
    searches.includes('200 ?q=') && searches.includes('200 ?q=zzz') && searches.includes('200 ?q=HEL'),
    `the relation searched the server by keyboard: ${searches.join(', ')}`,
  )
  check(!searches.some((s) => /q=(z|zz|H|HE)$/.test(s)), 'no request per keystroke')

  const file = page.getByLabel('Scan', { exact: true })
  await file.focus()
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('type') === 'file' && document.activeElement.tabIndex === 0),
    'the control a keyboard user focuses is the file input named Scan',
  )
  await file.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024 * 1024 + 1) })
  await page.getByText('The file is larger than 1 MB.').waitFor()
  await shows('scan', 'none')
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
  await page.getByText('This type of file is not accepted.').waitFor()
  check(
    await file.evaluate(
      (input) =>
        input.getAttribute('aria-invalid') === 'true' &&
        (input.getAttribute('aria-describedby') ?? '').split(' ').some((id) => document.getElementById(id)?.textContent.includes('not accepted')),
    ),
    'the file input is invalid and described by the refusal',
  )
  await shot('file-refused')
  await file.setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await shows('scan', 'scan.pdf, 8 B, application/pdf')

  await bar.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Choose a day.').waitFor()
  check((await bar.count()) === 1, 'saving without the required day shows the form error and stays unsaved')
  await shot('date-required')
  await page.getByLabel('Due on').fill('2026-12-24')
  await shows('dueOn', '2026-12-24')
  await shot('filled')
  await bar.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('status').filter({ hasText: 'Saved. 1' }).waitFor()
  await bar.waitFor({ state: 'detached' })
  check(true, 'Save clears the Unsaved changes bar')

  await page.getByLabel('Due on').fill('2026-12-25')
  await price.fill('9.999')
  await bar.getByRole('button', { name: 'Save' }).click()
  await price.fill('9.99')
  await shows('price', '999')
  await bar.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('status').filter({ hasText: 'Saved. 2' }).waitFor()
  check(true, 'Save with a malformed amount saved nothing: the next valid Save is the second')

  await page.getByRole('switch', { name: 'Lock the fields' }).click()
  for (const field of [page.getByLabel('Due on'), page.getByLabel('Publish at'), price, note, file])
    check(await field.isDisabled(), 'a locked field is disabled')
  await shot('locked')

  const titles = () => page.locator('tbody tr td:nth-child(2)').allTextContents()
  const order = async (...expected) => {
    await page.waitForFunction(
      (want) => [...document.querySelectorAll('tbody tr td:nth-child(2)')].map((td) => td.textContent.trim()).join('|') === want,
      expected.join('|'),
    )
    check(true, `rows: ${(await titles()).map((t) => t.trim()).join(', ')}`)
  }
  await order('Draft the contract', 'Collect signatures', 'File the deed', 'Send the invoice')
  await page.getByLabel('Due from').fill('2026-11-10')
  await page.getByLabel('Due to').fill('2026-11-30')
  await order('Collect signatures', 'File the deed')
  check(await page.getByRole('button', { name: 'Move File the deed up' }).isDisabled(), 'reorder is off while the date filter hides rows')
  await shot('date-range')
  await page.getByRole('button', { name: 'Reset' }).click()
  await order('Draft the contract', 'Collect signatures', 'File the deed', 'Send the invoice')
  check(await page.getByRole('button', { name: 'Move File the deed up' }).isEnabled(), 'reorder is on again once the unfiltered rows show')

  await page.getByRole('button', { name: 'Move File the deed up' }).focus()
  await page.keyboard.press('Enter')
  await order('Draft the contract', 'File the deed', 'Collect signatures', 'Send the invoice')
  await page.locator('[aria-live="polite"]').filter({ hasText: 'File the deed moved to position 2 of 4' }).waitFor()
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Move File the deed up',
    'focus follows the moved row and its move is announced',
  )
  await page.keyboard.press('Enter')
  await order('File the deed', 'Draft the contract', 'Collect signatures', 'Send the invoice')
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Move File the deed down',
    'at the top, focus moves to the row’s Move down button',
  )
  await shot('reordered-by-keyboard')

  await page.locator('tbody tr:nth-child(4) [draggable="true"]').dragTo(page.locator('tbody tr:nth-child(1)'))
  await order('Send the invoice', 'File the deed', 'Draft the contract', 'Collect signatures')
  await value('order').filter({ hasText: 'Send the invoice, File the deed, Draft the contract, Collect signatures' }).waitFor()
  check(true, 'a drag reports the new order to the screen')
  await shot('reordered-by-drag')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await page.getByRole('table', { name: 'Tasks' }).waitFor()
  await shot('dark')
}
