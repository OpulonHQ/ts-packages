import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  await page.goto(`${base}/admin/`)
  await page.getByText('Fixture dashboard override', { exact: true }).waitFor()
  await shot('dashboard-override')
  check(true, 'route-name override renders the host dashboard')
  await page.goto(`${base}/admin/copy-in-proof-missing-route`)
  await page.getByText('Fixture UI override', { exact: true }).waitFor()
  await shot('ui-override')
  check(true, 'package NotFound screen renders the host EmptyState')
}
