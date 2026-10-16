const { chromium } = await import(process.env.VERIFY_PW)
const [journeyPath, ...pairs] = process.argv.slice(2)
const args = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))
const base = process.env.VERIFY_BASE
const out = process.env.EVIDENCE_DIR
const session = process.env.VERIFY_SESSION

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })
const { existsSync } = await import('node:fs')
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ...(existsSync(session) ? { storageState: session } : {}),
  ...(process.env.VERIFY_VIDEO ? { recordVideo: { dir: out, size: { width: 1280, height: 800 } } } : {}),
})
await context.tracing.start({ screenshots: true, snapshots: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
let n = 0
const shot = async (name) => {
  const file = `${out}/${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  console.log(`shot ${file}`)
}
const check = (condition, message) => {
  if (!condition) throw new Error(`journey failed: ${message}`)
  console.log(`ok  ${message}`)
}
let failed = false
try {
  await (await import(journeyPath)).default({ page, base, shot, args, check })
  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
} catch (error) {
  failed = true
  console.error(String(error))
  await shot('failure').catch(() => {})
} finally {
  await context.tracing.stop({ path: `${out}/trace.zip` })
  if ((await context.request.get(`${base}/api/me`)).ok()) await context.storageState({ path: session })
  await context.close()
  await browser.close()
  console.log(`evidence: ${out}`)
}
process.exit(failed ? 1 : 0)
