import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, args, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const api = (suffix, method) => (r) => r.url().includes(`/api/users${suffix}`) && r.request().method() === method
  const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor()
  const me = await (await page.request.get(`${base}/api/me`)).json()

  const invitee = `pending-${run}@example.test`
  await page.goto(`${base}/admin/users`)
  await page.getByRole('button', { name: 'Invite' }).click()
  await page.getByRole('textbox', { name: 'Email' }).fill(invitee)
  await page.getByRole('button', { name: 'Send the invitation' }).click()
  const pending = page.getByRole('row').filter({ hasText: invitee })
  await pending.waitFor()
  await shot('invitation-listed')
  const resent = page.waitForResponse(api('/invitations/', 'POST'))
  await pending.getByRole('button', { name: 'Send again' }).click()
  check((await resent).status() === 200, `POST ${new URL((await resent).url()).pathname.replace(/[0-9a-f-]{36}/, ':id')} ${(await resent).status()}`)
  await status(`A new invitation to ${invitee} is on its way.`)
  const revoked = page.waitForResponse(api('/invitations/', 'DELETE'))
  await pending.getByRole('button', { name: 'Revoke' }).click()
  check((await revoked).status() === 204, `DELETE /api/users/invitations/:id ${(await revoked).status()}`)
  await status(`The invitation to ${invitee} is revoked.`)
  await pending.waitFor({ state: 'detached' })
  await shot('invitation-revoked')

  const role = `Temporary ${run}`
  await page.goto(`${base}/admin/roles`)
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(role)
  await page.getByRole('button', { name: 'Save' }).click()
  await status('The role is saved.')
  await page.getByRole('cell', { name: role }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await shot('role-delete-confirm')
  const deleted = page.waitForResponse(api('/roles/', 'DELETE'))
  await page.getByRole('button', { name: 'Delete the role' }).click()
  check((await deleted).status() === 204, `DELETE /api/users/roles/:id ${(await deleted).status()}`)
  await status('The role is deleted.')
  check((await page.getByRole('cell', { name: role }).count()) === 0, 'the deleted role left the list')
  await shot('role-deleted')

  const other = await page.context().browser().newContext()
  const elsewhere = await other.request.post(`${base}/api/users/auth/sign-in`, {
    headers: { origin: base },
    data: { email: args.email, password: args.password },
  })
  check(elsewhere.status() === 200, `a second session signs in: ${elsewhere.status()}`)
  const changePassword = async (current, next) => {
    const answered = page.waitForResponse(api('/password', 'PUT'))
    await page.getByRole('textbox', { name: 'Current password' }).fill(current)
    await page.getByRole('textbox', { name: 'New password' }).fill(next)
    await page.getByRole('textbox', { name: 'Repeat the password' }).fill(next)
    await page.getByRole('button', { name: 'Change the password' }).click()
    return (await answered).status()
  }
  const changed = `${args.password} changed`
  await page.goto(`${base}/admin/account`)
  check((await changePassword('not the password', changed)) === 403, 'a wrong current password: PUT /api/users/password 403')
  await page.getByRole('alert').filter({ hasText: 'The current password is wrong.' }).waitFor()
  await shot('password-wrong')
  check((await changePassword(args.password, changed)) === 204, 'PUT /api/users/password 204')
  await status('Your password is changed.')
  await shot('password-changed')
  check((await page.request.get(`${base}/api/me`)).status() === 200, 'the session that changed the password stays')
  check((await other.request.get(`${base}/api/me`)).status() === 401, 'the second session ended')
  await other.close()
  check((await changePassword(changed, args.password)) === 204, 'the password is put back: 204')

  const signIn = async (email) => {
    await page.getByRole('button', { name: 'Sign in' }).waitFor()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(args.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('link', { name: 'Dashboard' }).waitFor()
    await page.goto(`${base}/admin/users/${me.user.id}`)
    await page.getByRole('button', { name: 'Save the name and email' }).waitFor()
  }
  const saveDetails = async (name, email) => {
    const saved = page.waitForResponse(api(`/users/${me.user.id}`, 'PUT'))
    await page.getByRole('textbox', { name: 'Name' }).fill(name)
    await page.getByRole('textbox', { name: 'Email' }).fill(email)
    await page.getByRole('button', { name: 'Save the name and email' }).click()
    return (await saved).status()
  }
  const moved = `moved-${run}@example.test`
  await page.goto(`${base}/admin/users/${me.user.id}`)
  await page.getByRole('button', { name: 'Save the name and email' }).waitFor()
  check((await saveDetails(`Owner ${run}`, args.email)) === 204, 'a new name: PUT /api/users/users/:id 204')
  await status('The name and email are saved.')
  await shot('name-saved')
  check((await saveDetails(`Owner ${run}`, moved)) === 204, 'a new email: PUT /api/users/users/:id 204')
  await signIn(moved)
  check(true, `the email change signed the user out; signed in again as ${moved}`)
  await shot('signed-in-with-new-email')

  const audit = await page.evaluate(() => fetch('/api/audit?module=users&perPage=100').then((r) => r.json()))
  const actions = new Set(audit.rows.map((r) => r.action))
  for (const action of ['users.updated', 'users.invitation_revoked', 'users.role_deleted', 'users.password_changed'])
    check(actions.has(action), `audit log has ${action}`)
  check(audit.rows.filter((r) => r.action === 'users.invited' && r.subject?.label === invitee).length === 2, 'audit log has users.invited twice for the invitee')

  check((await saveDetails(me.user.name, args.email)) === 204, 'the name and email are put back: 204')
  await page.getByRole('button', { name: 'Sign in' }).waitFor()
}
