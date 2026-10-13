// Signs in, creates a role, invites a user with it, and finds the invitation in the Email log.
// ui.sh journeys/users-and-roles.mjs email=<super admin> password=<password>
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, args, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const role = `Editors ${run}`
  const invitee = `invitee-${run}@example.test`

  await page.goto(`${base}/admin/roles`)
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(role)
  await page.getByRole('checkbox', { name: 'Invite and manage users' }).check()
  await shot('role-filled')
  const saved = page.waitForResponse((r) => r.url().includes('/api/users/roles') && r.request().method() !== 'GET')
  await page.getByRole('button', { name: 'Save' }).click()
  check((await saved).ok(), `role saved: ${(await saved).request().method()} /api/users/roles ${(await saved).status()}`)
  await page.getByRole('status').filter({ hasText: 'The role is saved.' }).waitFor()
  await page.getByText(role).first().waitFor()
  await shot('role-saved')

  await page.goto(`${base}/admin/users`)
  await page.getByRole('button', { name: 'Invite' }).click()
  await page.getByRole('textbox', { name: 'Email' }).fill(invitee)
  await page.getByRole('checkbox', { name: role }).check()
  await shot('invite-filled')
  const invite = page.waitForResponse((r) => r.url().endsWith('/api/users/invitations') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Send the invitation' }).click()
  check((await invite).status() === 200, 'POST /api/users/invitations 200')
  await page.getByRole('status').filter({ hasText: `The invitation to ${invitee} is on its way.` }).waitFor()
  await shot('invited')

  // The inline invite form stays open after sending; Invite toggles it.
  await page.getByRole('textbox', { name: 'Email' }).fill(args.email)
  await page.getByRole('button', { name: 'Send the invitation' }).click()
  await page.getByRole('alert').filter({ hasText: 'A user with this email already exists.' }).waitFor()
  check(true, 'inviting an existing user is refused')
  await shot('duplicate-refused')

  await page.getByRole('link', { name: 'Email log' }).click()
  await page.getByRole('cell', { name: invitee }).first().waitFor()
  await shot('email-log')
  const log = await page.evaluate(() => fetch('/api/emails/log?perPage=100').then((r) => r.json()))
  const row = log.rows.find((r) => r.recipients.includes(invitee))
  check(row?.templateKey === 'users.invitation', `email log: ${row?.templateKey} to ${invitee}, ${row?.status}`)
}
