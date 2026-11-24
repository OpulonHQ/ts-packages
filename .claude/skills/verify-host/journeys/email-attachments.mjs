import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const to = `notary-${run}@example.test`
  const share = (data) => page.request.post(`${base}/api/demo/notes/share`, { headers: { origin: base }, data })

  const shared = await share({
    to,
    cc: [`copy-${run}@example.test`],
    bcc: [`hidden-${run}@example.test`],
    replyTo: `sender-${run}@example.test`,
    note: `Deed ${run}`,
  })
  check(shared.status() === 200, `POST /api/demo/notes/share ${shared.status()}`)
  const { id } = await shared.json()

  const fallback = await share({ to: `fallback-${run}@example.test`, note: 'x' })
  check(fallback.status() === 200, `share without a reply-to ${fallback.status()}`)

  for (const [scope, sizes] of [['stored', { storedBytes: 4 * 1024 * 1024 + 1 }], ['total', { fetchedBytes: 10 * 1024 * 1024 + 1 }]]) {
    const tooLarge = await share({ to, note: 'x', ...sizes })
    const refusal = await tooLarge.json()
    check(tooLarge.status() === 413 && refusal._tag === 'AttachmentsTooLarge' && refusal.scope === scope, `over the ${scope} limit: ${tooLarge.status()} ${refusal.message}`)
  }

  const log = await (await page.request.get(`${base}/api/emails/log?perPage=100`)).json()
  const row = log.rows.find((r) => r.id === id)
  check(row?.status === 'sent', `email log row ${row?.status}`)
  check(row.cc[0] === `copy-${run}@example.test` && row.bcc[0] === `hidden-${run}@example.test`, 'log API: cc and bcc')
  check(row.replyTo === `sender-${run}@example.test`, `log API: reply-to ${row.replyTo}`)
  check(
    JSON.stringify(row.attachments) === JSON.stringify([{ filename: 'note.txt', size: `Deed ${run}`.length }, { filename: 'private.txt', size: 52 }]),
    `log API: attachments ${JSON.stringify(row.attachments)}`,
  )
  const configured = log.rows.find((r) => r.recipients[0] === `fallback-${run}@example.test`)
  check(configured?.replyTo === 'help@example.test', `reply-to falls back to the configured ${configured?.replyTo}`)
  check(log.rows.every((r) => r.recipients[0] !== to || r.id === id), 'the refused sends left no log row')

  await page.goto(`${base}/admin/emails/log`)
  const line = page.getByRole('row').filter({ hasText: to })
  await line.waitFor()
  const text = await line.innerText()
  for (const part of [`Cc: copy-${run}@example.test`, `Bcc: hidden-${run}@example.test`, `Reply to: sender-${run}@example.test`, 'note.txt (', 'private.txt (52 byte)', 'Sent'])
    check(text.includes(part), `Email log row shows "${part}"`)
  await shot('email-log-attachments')
}
