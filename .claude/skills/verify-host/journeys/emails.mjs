// Customises the invitation subject, sends an invite, and finds the new subject in the Email log.
// ui.sh journeys/emails.mjs email=<super admin> password=<password>
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const subject = `Verify invitation ${run}`
  await page.goto(`${base}/admin/emails/templates`)
  await shot('templates')
  await page.goto(`${base}/admin/emails/templates/users.invitation`)
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject)
  const save = page.waitForResponse((r) => r.url().endsWith('/api/emails/templates/users.invitation/locales/en'))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  check((await save).status() === 200, 'PUT /api/emails/templates/users.invitation/locales/en 200')
  await page.getByRole('status').filter({ hasText: 'The template was saved.' }).waitFor()
  await shot('template-saved')

  const invitee = `mail-${run}@example.test`
  await page.goto(`${base}/admin/users`)
  await page.getByRole('button', { name: 'Invite' }).click()
  await page.getByRole('textbox', { name: 'Email' }).fill(invitee)
  const invite = page.waitForResponse((r) => r.url().endsWith('/api/users/invitations') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Send the invitation' }).click()
  check((await invite).status() === 200, `invite ${invitee} 200`)

  await page.getByRole('link', { name: 'Email log' }).click()
  const row = page.getByRole('row').filter({ hasText: invitee })
  await row.filter({ hasText: subject }).filter({ hasText: 'Sent' }).waitFor()
  check(true, `Email log row: ${invitee}, "${subject}", Sent`)
  await shot('email-log')
}
