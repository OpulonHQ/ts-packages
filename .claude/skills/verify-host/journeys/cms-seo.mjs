// ui.sh journeys/cms-seo.mjs email=<user with cms rights> password=<password>
import { buildHead } from '../../../../packages/cms/dist/site/index.mjs'
import signedIn from './signed-in.mjs'

export default async (ctx) => {
  const { page, base, shot, check } = ctx
  await signedIn(ctx)
  const run = Date.now().toString(36)
  const path = `/seo-${run}`
  const origin = 'https://example.test'
  const api = (method, url, data) =>
    page.request.fetch(`${base}/api/cms${url}`, { method, headers: { origin: base }, data })

  const untouched = await api('POST', '/pages', {
    locales: {
      en: {
        path: `/plain-${run}`,
        available: true,
        seo: { title: 'Plain', description: 'As before', image: null, noindex: false },
      },
    },
    sections: [],
  })
  const plain = await untouched.json()
  await api('POST', `/pages/${plain.id}/publish?version=${plain.version}`)
  const plainResolved = await (await api('GET', `/resolve?path=/plain-${run}`)).json()
  const siteBefore = await (await api('GET', '/site?locale=en')).json()
  const handleBefore = siteBefore.settings.twitterHandle
  const plainHead = buildHead(plainResolved, siteBefore, { origin })
  check(
    JSON.stringify(Object.keys(plainResolved.seo)) === '["title","description","image","noindex"]',
    `a page without the new fields resolves seo keys ${Object.keys(plainResolved.seo)}`,
  )
  check(
    !('script' in plainHead) &&
      !plainHead.meta.some((m) => m.name === 'keywords') &&
      plainHead.link[0].href === `${origin}/plain-${run}` &&
      (handleBefore || !plainHead.meta.some((m) => m.name?.startsWith('twitter:'))),
    `a page without the new fields: no script, no keywords, canonical ${plainHead.link[0].href}, twitter tags only with a handle (handle: ${handleBefore ?? 'none'})`,
  )

  await page.goto(`${base}/admin/cms/pages`)
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Blank page/ }).click()
  await page.waitForURL(/\/admin\/cms\/pages\/[0-9a-f-]{36}/)
  const id = page.url().split('/').pop()
  const field = (name) => page.getByRole('textbox', { name })
  const save = async () => {
    const draft = page.waitForResponse(
      (r) => r.url().includes(`/api/cms/pages/${id}/draft?`) && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Save draft' }).click()
    return draft
  }

  await field('Path').fill(path)
  await page.getByRole('checkbox', { name: 'English' }).click()
  await field('SEO title').fill(`Offer ${run}`)
  await field('SEO description').fill('Our offer')
  await field('Keywords').fill('notary, rome')
  await field('Canonical URL').fill('/original-offer')
  await field('Structured data (JSON-LD)').fill('{"@type": "Organization"')
  const refused = await save()
  const refusal = await refused.json()
  check(
    refused.status() === 400 && refusal.message === 'The en structured data is not valid JSON.',
    `Save with broken JSON-LD: ${refused.status()} ${refusal._tag} "${refusal.message}"`,
  )
  await shot('json-ld-refused')

  const jsonLd =
    '{"@context":"https://schema.org","@type":"Organization","name":"</script><script>window.pwned=1</script> & co"}'
  await field('Structured data (JSON-LD)').fill(jsonLd)
  check((await save()).status() === 200, 'Save draft with valid JSON-LD: 200')
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor()
  await shot('seo-fields-saved')

  const publish = page.waitForResponse((r) => r.url().includes(`/api/cms/pages/${id}/publish?`))
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const published = await (await publish).json()
  check(published.status === 'published', 'Publish: status published')
  await page.getByRole('status').filter({ hasText: 'Published.' }).waitFor()

  const revision = await (
    await api('GET', `/pages/${id}/revisions/${published.publishedRevisionId}`)
  ).json()
  const kept = revision.document.locales.en.seo
  check(
    kept.keywords === 'notary, rome' &&
      kept.canonical === '/original-offer' &&
      kept.jsonLd === jsonLd,
    `revision ${published.publishedRevisionId} keeps keywords, canonical and JSON-LD`,
  )

  const settings = await (await api('GET', '/settings')).json()
  const savedSettings = await api('PUT', `/settings/draft?version=${settings.version}`, {
    data: { ...settings.draft.data, siteName: { en: 'Example' }, twitterHandle: 'example' },
  })
  check(savedSettings.status() === 200, 'site settings: twitterHandle saved')
  const settingsVersion = (await savedSettings.json()).version
  check(
    (await api('POST', `/settings/publish?version=${settingsVersion}`)).status() === 200,
    'site settings: published',
  )

  const resolved = await (
    await page.request.get(`${base}/api/cms/resolve?path=${encodeURIComponent(path)}`)
  ).json()
  const site = await (await page.request.get(`${base}/api/cms/site?locale=en`)).json()
  check(
    resolved.seo.keywords === 'notary, rome' &&
      resolved.seo.canonical === '/original-offer' &&
      resolved.seo.jsonLd === jsonLd,
    `GET /api/cms/resolve?path=${path}: seo carries keywords, canonical and JSON-LD`,
  )

  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', name: '</script>' }
  const head = buildHead(resolved, site, { origin, jsonLd: [faq] })
  console.log(`head ${JSON.stringify(head, null, 1)}`)
  const meta = (key) => head.meta.find((m) => (m.name ?? m.property) === key)?.content
  check(meta('keywords') === 'notary, rome', `meta keywords: ${meta('keywords')}`)
  check(
    head.link[0].href === `${origin}/original-offer` &&
      meta('og:url') === `${origin}/original-offer`,
    `canonical override: link ${head.link[0].href}, og:url ${meta('og:url')}`,
  )
  check(
    meta('twitter:card') === 'summary' &&
      meta('twitter:site') === '@example' &&
      meta('twitter:title') === head.title &&
      meta('twitter:description') === 'Our offer',
    `twitter tags: card ${meta('twitter:card')}, site ${meta('twitter:site')}, title ${meta('twitter:title')}, description ${meta('twitter:description')}`,
  )
  check(
    head.script.length === 2 && head.script.every((s) => !/[<>&]/.test(s.innerHTML)),
    `2 ld+json scripts (editor, then host), none holds <, > or &`,
  )

  const probe = await page.context().newPage()
  await probe.setContent(
    `<!doctype html><html><head>${head.script
      .map((s) => `<script type="${s.type}">${s.innerHTML}</script>`)
      .join('')}</head><body></body></html>`,
  )
  const rendered = await probe.evaluate(() => ({
    scripts: [...document.scripts].map((s) => ({ type: s.type, data: JSON.parse(s.textContent) })),
    pwned: 'pwned' in window,
  }))
  await probe.close()
  check(
    rendered.scripts.length === 2 &&
      !rendered.pwned &&
      JSON.stringify(rendered.scripts[0].data) === JSON.stringify(JSON.parse(jsonLd)) &&
      JSON.stringify(rendered.scripts[1].data) === JSON.stringify(faq),
    `in Chrome the head holds exactly 2 ld+json scripts whose JSON equals the input; the </script> payload did not run`,
  )

  await shot('published')
}
