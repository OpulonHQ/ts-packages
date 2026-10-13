import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const status = async () => {
    const response = await page.request.get(`${base}/api/cms/cache-purges`)
    check(response.status() === 200, 'editor can read purge status')
    return response.json()
  }
  const before = await status()
  check(before.summary.total > 0, 'refused purges survived the workerd restart')
  await page.goto(`${base}/admin/cms/pages`)
  await page.getByText('Live site may show the previous version', { exact: false }).waitFor()
  await shot('pending-before-sweep')
  const scheduled = await page.request.get(`${base}/__scheduled?cron=*/5+*+*+*+*`)
  check(scheduled.status() === 200, 'local scheduled event ran')
  const after = await status()
  check(
    after.summary.total === 0 && after.rows.length === 0,
    'scheduled retry purged and removed the durable failures',
  )
  await page.reload()
  await page.getByRole('table').first().waitFor()
  check(
    (await page.getByText('Live site may show the previous version', { exact: false }).count()) ===
      0,
    'editor warning cleared after recovery',
  )
  await shot('recovered-after-sweep')
}
