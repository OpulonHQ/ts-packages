import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { URL } from 'node:url'
import pg from 'pg'
import signedIn from '../../../.claude/skills/verify-host/journeys/signed-in.mjs'
import captureListPlans from './list-plans.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const db = new pg.Client({ connectionString: process.env.VERIFY_DATABASE_URL })
  await db.connect()
  const api = async (method, path, data) => {
    const result = await page.request.fetch(`${base}/api${path}`, {
      method,
      headers: { Origin: base },
      ...(data === undefined ? {} : { data }),
    })
    check(result.ok(), `${method} ${path} ${result.status()}`)
    return result.status() === 204 ? null : result.json()
  }
  const manifestPath = '.verify/paging-data.json'
  let state = { run: Date.now().toString(36), users: [], posts: [], categories: [] }
  try {
    state = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const save = () => writeFile(manifestPath, JSON.stringify(state))
  await save()
  await db.query(`create table if not exists public.verify_invitation_mail (email text primary key, html text);
    create or replace function public.verify_invitation_mail_capture() returns trigger language plpgsql as $$
    begin if new.template_key = 'users.invitation' then insert into public.verify_invitation_mail values (new.recipients ->> 0, new.message ->> 'html') on conflict (email) do update set html = excluded.html; end if; return new; end $$;
    drop trigger if exists verify_invitation_mail_capture on emails.email_log;
    create trigger verify_invitation_mail_capture after insert on emails.email_log for each row execute function public.verify_invitation_mail_capture();`)
  let ip = 1
  const publicCall = async (path, data) => {
    const response = await globalThis.fetch(`${base}/api/users${path}`, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `198.51.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
      },
      body: JSON.stringify(data),
    })
    check(response.ok, `public ${path} ${response.status}`)
    return response
  }
  async function staff(number) {
    const email = `paging-${state.run}-${String(number).padStart(3, '0')}@example.test`
    const password = 'paging fixture password'
    const existing = await api('GET', `/users/users?search=${encodeURIComponent(email)}`)
    if (existing.users.some((user) => user.email === email)) return { email, password }
    await api('POST', '/users/invitations', { email, roleIds: [] })
    const { rows } = await db.query(
      'select html from public.verify_invitation_mail where email = $1',
      [email],
    )
    const match = /#token=([^"&<\s]+)/.exec(rows[0]?.html ?? '')
    check(Boolean(match), 'invitation delivered to email log')
    await publicCall('/invitations/accept', {
      token: decodeURIComponent(match[1]),
      name: `Paging ${String(number).padStart(3, '0')}`,
      password,
    })
    return { email, password }
  }
  try {
    for (let n = state.users.length + 1; n <= 240; n++) {
      state.users.push(await staff(n))
      await save()
    }
    for (const [collection, count] of [
      ['posts', 600],
      ['categories', 45],
    ]) {
      for (let n = state[collection].length + 1; n <= count; n++) {
        const title = `Paging ${String(n).padStart(3, '0')}`
        const item = await api('POST', `/cms/collections/${collection}/items`, {
          locales: {},
          data: collection === 'posts' ? { title: { en: title } } : { name: { en: title } },
        })
        state[collection].push(item)
        await save()
      }
    }
    const first = await api('GET', '/users/users?perPage=25&search=Paging&sort=name&direction=asc')
    const second = await api(
      'GET',
      '/users/users?perPage=25&page=2&search=Paging&sort=name&direction=asc',
    )
    check(
      first.users.length === 25 && second.users[0].name === 'Paging 026' && first.total === 240,
      'users API returns separate pages of 25 and total 240',
    )
    const items = await api(
      'GET',
      '/cms/collections/posts/items?perPage=25&page=2&search=Paging&sort=title&direction=asc',
    )
    check(
      items.rows.length === 25 && items.rows[0].title === 'Paging 026' && items.total === 600,
      'items API returns page two and total 600',
    )
    const denySession = await publicCall('/auth/sign-in', state.users[0])
    const cookie = denySession.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    for (const path of [
      '/users/users?page=2&search=Paging',
      '/cms/collections/posts/items?page=2&search=Paging',
    ]) {
      const result = await globalThis.fetch(`${base}/api${path}`, {
        headers: { Origin: base, Cookie: cookie },
      })
      check(result.status === 403, `signed-in staff without permission GET ${path} 403`)
    }
    const batch = await api(
      'GET',
      `/cms/collections/posts/items?ids=${encodeURIComponent([state.posts[30].id, state.categories[0].id, state.posts[0].id, state.posts[0].id.toUpperCase()].join(','))}&perPage=100&sort=title&direction=asc`,
    )
    check(
      batch.total === 2 &&
        batch.rows.map((row) => row.title).join(',') === 'Paging 001,Paging 031' &&
        batch.rows.every((row) => !('draft' in row)),
      'ID batch deduplicates case variants, keeps defined order, returns summaries, and excludes foreign-collection IDs',
    )
    const foreign = await api('GET', `/cms/collections/posts/items?ids=${state.categories[0].id}`)
    check(foreign.total === 0 && foreign.rows.length === 0, 'foreign collection ID returns no rows')
    for (const value of [
      '',
      'not-a-uuid',
      Array.from({ length: 101 }, () => state.posts[0].id).join(','),
    ]) {
      const response = await page.request.get(
        `${base}/api/cms/collections/posts/items?ids=${encodeURIComponent(value)}`,
        { headers: { Origin: base } },
      )
      check(
        response.status() === 400,
        `invalid ID batch with ${value ? value.split(',').length : 0} values returns 400`,
      )
    }
    const forbiddenBatch = await globalThis.fetch(
      `${base}/api/cms/collections/posts/items?ids=${state.posts[0].id}`,
      { headers: { Origin: base, Cookie: cookie } },
    )
    check(
      forbiddenBatch.status === 403,
      'ID batch remains forbidden to signed-in staff without view permission',
    )
    const firstUser = (
      await api('GET', `/users/users?search=${encodeURIComponent(state.users[0].email)}`)
    ).users[0]
    await api('POST', `/users/users/${firstUser.id}/deactivate`)
    try {
      const defaultFirst = await api('GET', '/users/users?search=Paging&perPage=100')
      const defaultLast = await api('GET', '/users/users?search=Paging&perPage=100&page=3')
      const explicit = await api(
        'GET',
        '/users/users?search=Paging&perPage=100&sort=name&direction=asc',
      )
      check(
        defaultFirst.users[0].name === 'Paging 002' &&
          defaultLast.users.at(-1).name === 'Paging 001' &&
          explicit.users[0].name === 'Paging 001',
        'default order retains active-first parity; explicit name sort remains alphabetical',
      )
    } finally {
      await api('POST', `/users/users/${firstUser.id}/reactivate`)
    }
    await captureListPlans(db, process.env.EVIDENCE_DIR, check)
  } finally {
    await db.query(
      'drop trigger if exists verify_invitation_mail_capture on emails.email_log; drop function if exists public.verify_invitation_mail_capture(); drop table if exists public.verify_invitation_mail',
    )
    await db.end()
  }
  await page.goto(`${base}/admin/users`)
  const usersTable = page.getByRole('table', { name: 'Users', exact: true })
  await usersTable.getByRole('row').filter({ hasText: 'Paging 001' }).waitFor()
  check((await usersTable.locator('tbody tr').count()) === 25, 'users SPA only renders one page')
  await shot('users-page-one')
  await page.getByRole('button', { name: 'Page 2', exact: true }).click()
  await usersTable.getByRole('row').filter({ hasText: 'Paging 026' }).waitFor()
  await shot('users-page-two')
  await page.getByRole('textbox', { name: 'Search…', exact: true }).fill('Paging 240')
  await usersTable.getByRole('row').filter({ hasText: 'Paging 240' }).waitFor()
  await usersTable.getByRole('row').filter({ hasText: 'Paging 026' }).waitFor({ state: 'hidden' })
  check((await usersTable.locator('tbody tr').count()) === 1, 'users search resets to page one')
  await usersTable.getByRole('row').filter({ hasText: 'Paging 240' }).click()
  await page.getByRole('heading', { name: 'Paging 240', exact: true }).waitFor()
  await shot('user-beyond-first-page')
  await page.goto(`${base}/admin/cms/collections/posts`)
  const table = page.getByRole('table', { name: 'Posts', exact: true })
  await table.getByRole('row').filter({ hasText: 'Paging 600' }).waitFor()
  await table.getByRole('button', { name: 'Sort by Title', exact: true }).click()
  await table.getByRole('row').filter({ hasText: 'Paging 001' }).waitFor()
  await shot('items-title-sort')
  await page.getByRole('button', { name: 'Page 2', exact: true }).click()
  await table.getByRole('row').filter({ hasText: 'Paging 026' }).waitFor()
  await shot('items-page-two')
  await page.getByRole('textbox', { name: 'Search…', exact: true }).fill('Paging 600')
  await table.getByRole('row').filter({ hasText: 'Paging 600' }).waitFor()
  check((await table.locator('tbody tr').count()) === 1, 'item search resets to page one')
  const selectedDraft =
    (await api('GET', `/cms/items/${state.posts[0].id}`)).draft.data.categories ?? []
  await page.goto(`${base}/admin/cms/items/${state.posts[0].id}`)
  const picker = page.getByRole('group', { name: 'Categories', exact: true })
  const pickerTable = picker.getByRole('table', { name: 'Categories', exact: true })
  await pickerTable.getByRole('row').filter({ hasText: 'Paging 001' }).waitFor()
  await shot('reference-first-page')
  await picker.getByRole('button', { name: 'Page 2', exact: true }).click()
  await pickerTable.getByRole('row').filter({ hasText: 'Paging 026' }).waitFor()
  if (!selectedDraft.includes(state.categories[25].id))
    await pickerTable.getByRole('row').filter({ hasText: 'Paging 026' }).click()
  await picker.getByRole('button', { name: 'Remove Paging 026', exact: true }).waitFor()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  let oldSeen
  const oldStarted = new Promise((resolve) => {
    oldSeen = resolve
  })
  await page.route('**/api/cms/collections/categories/items?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === 'Paging 001') {
      const response = await route.fetch()
      oldSeen()
      await blocked
      await route.fulfill({ response })
    } else await route.continue()
  })
  const search = picker.getByRole('textbox', { name: 'Search items…', exact: true })
  await search.fill('Paging 001')
  await oldStarted
  const newerSearch = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('search') === 'Paging 045',
  )
  await search.fill('Paging 045')
  await newerSearch
  await pickerTable.locator('tbody tr').nth(1).waitFor({ state: 'hidden' })
  await pickerTable.getByRole('row').filter({ hasText: 'Paging 045' }).waitFor()
  release()
  await page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('search') === 'Paging 001',
  )
  await page.waitForTimeout(100)
  check(
    (await pickerTable.getByRole('row').filter({ hasText: 'Paging 045' }).count()) === 1 &&
      (await pickerTable.getByRole('row').filter({ hasText: 'Paging 001' }).count()) === 0,
    'slow older picker response cannot overwrite newer search',
  )
  if (!selectedDraft.includes(state.categories[44].id))
    await pickerTable.getByRole('row').filter({ hasText: 'Paging 045' }).click()
  await picker.getByRole('button', { name: 'Remove Paging 045', exact: true }).waitFor()
  await shot('reference-search-and-selection')
  const savedDraft = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cms/items/${state.posts[0].id}/draft`) &&
      response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  check((await savedDraft).status() === 200, 'selected references save through the item draft API')
  const stored = await api('GET', `/cms/items/${state.posts[0].id}`)
  check(
    stored.draft.data.categories.includes(state.categories[25].id) &&
      stored.draft.data.categories.includes(state.categories[44].id),
    'both references remain selected across page and search changes',
  )
  await page.route('**/api/cms/items/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    if (route.request().method() === 'GET' && state.categories.some((item) => item.id === id))
      await route.abort()
    else await route.continue()
  })
  const coldBatch = page.waitForResponse(
    (response) =>
      response.url().includes('/api/cms/collections/categories/items?') &&
      new URL(response.url()).searchParams.has('ids'),
  )
  await page.reload()
  const coldResult = await coldBatch
  check(
    coldResult.status() === 200 && (await coldResult.json()).rows.length === 2,
    'cold saved selections load in one bounded summary batch while individual document requests are unavailable',
  )
  await picker.getByRole('button', { name: 'Remove Paging 026', exact: true }).waitFor()
  await picker.getByRole('button', { name: 'Remove Paging 045', exact: true }).waitFor()
  await picker.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await shot('reference-persisted')
  await page.setViewportSize({ width: 390, height: 844 })
  await picker.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await shot('reference-phone')
  await page.setViewportSize({ width: 1280, height: 800 })
  await api('PUT', '/cms/settings/draft', {
    data: { cta: { type: 'item', id: state.posts[599].id } },
  })
  await page.goto(`${base}/admin/cms/settings`)
  const clearLink = page.getByRole('button', { name: 'Remove Paging 600', exact: true })
  await clearLink.waitFor()
  await page
    .getByRole('table', { name: 'Target', exact: true })
    .getByRole('row')
    .filter({ hasText: 'Paging 001' })
    .waitFor()
  await shot('single-reference-beyond-first-page')
  await page.route('**/api/cms/items/*', async (route) => {
    if (
      route.request().method() === 'GET' &&
      new URL(route.request().url()).pathname.endsWith(`/items/${state.posts[0].id}`)
    )
      await route.abort()
    else await route.fallback()
  })
  await page
    .getByRole('table', { name: 'Target', exact: true })
    .getByRole('row')
    .filter({ hasText: 'Paging 001' })
    .click()
  const chosenLink = page.getByRole('button', { name: 'Remove Paging 001', exact: true })
  await chosenLink.waitFor()
  check(
    (await page.getByRole('alert').count()) === 0,
    'changing the known item target uses its row summary without another full-document request',
  )
  await chosenLink.click()
  const savedSettings = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/cms/settings/draft') && response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  check((await savedSettings).status() === 200, 'single reference clears and saves successfully')
  check(
    !Object.hasOwn((await api('GET', '/cms/settings')).draft.data, 'cta'),
    'cleared single reference is absent from the persisted draft',
  )
  await shot('single-reference-cleared')
  await page.unroute('**/api/cms/items/*')
  const doomed = await api('POST', '/cms/collections/categories/items', {
    locales: {},
    data: { name: { en: 'Removed fixture reference' } },
  })
  const draft = (await api('GET', `/cms/items/${state.posts[0].id}`)).draft
  await api('PUT', `/cms/items/${state.posts[0].id}/draft`, {
    ...draft,
    data: { ...draft.data, categories: [...draft.data.categories, doomed.id] },
  })
  await api('DELETE', `/cms/items/${doomed.id}`)
  await page.goto(`${base}/admin/cms/items/${state.posts[0].id}`)
  const missing = page.getByRole('button', {
    name: `Remove Missing or deleted item (${doomed.id})`,
    exact: true,
  })
  await missing.waitFor()
  check(
    (await page.getByRole('alert').count()) === 0,
    'deleted saved reference is marked missing without a load-failed alert',
  )
  await missing.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await shot('missing-reference')
  await missing.click()
  const removedReference = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/cms/items/${state.posts[0].id}/draft`) &&
      response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  check(
    (await removedReference).status() === 200,
    'missing reference chip can be removed and saved',
  )
}
