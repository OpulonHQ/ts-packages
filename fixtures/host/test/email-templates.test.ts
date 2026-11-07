import { defineAdminModule } from '@opulonjs/admin'
import { EmailTemplateList } from '@opulonjs/emails/api'
import { emailsAdmin } from '@opulonjs/emails/admin'
import { Schema } from 'effect'
import { beforeEach, expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeShop } from './support/shop.ts'

// Runs in the `admin` vitest project: the email template screens mounted in happy-dom, their
// fetch routed into the shop worker (signed in as Eva, admin locale sk). No mocked API.
const admin = useAdminLifetime()
const db = useTestDatabase()
const shop = admin.track(makeShop(() => db.url))
const order = 'shop.order_confirmed'

/**
 * The screen's writes (`PUT /path`), a predicate that makes matching requests fail, and one that
 * holds matching requests until the promise it returns settles.
 */
const writes: string[] = []
let failing: ((request: Request) => boolean) | undefined
let holding: ((request: Request) => Promise<void> | undefined) | undefined
beforeEach(() => {
  writes.length = 0
  failing = undefined
  holding = undefined
})
const hostFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  if (request.method === 'PUT') writes.push(`PUT ${new URL(request.url).pathname}`)
  if (failing?.(request)) return new Response('down', { status: 503 })
  await holding?.(request)
  const pending: Array<Promise<unknown>> = []
  const response = await shop.fetch(request, (p) => pending.push(p))
  const body = await response.arrayBuffer()
  await Promise.all(pending)
  // A 204 (the switch's answer) may not carry a body, not even an empty one.
  return new Response(response.status === 204 ? null : body, response)
}

// The shop has no users module; this stands in as the shell's auth provider.
const shopAdmin = defineAdminModule({
  id: 'shop',
  auth: { signInRoute: 'shop.signIn' },
  routes: [
    {
      name: 'shop.signIn',
      path: '/sign-in',
      public: true,
      component: async () => ({ default: { render: () => null } }),
    },
  ],
  messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
})

const mount = (path: string) =>
  admin.mount(path, { fetch: hostFetch, modules: [shopAdmin, emailsAdmin()], buildId: 'test' })

const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
const bar = () => document.querySelector('[role="region"][aria-label="Neuložené zmeny"]')
/** Clicks the unsaved-changes bar's Save once it shows and no request of the editor runs. */
const saveFromBar = async () => {
  const save = () =>
    [...(bar()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Uložiť')
  await expect.poll(() => save()?.disabled).toBe(false)
  save()!.click()
}
const overrideOf = async (locale: string) => {
  const list = Schema.decodeUnknownSync(EmailTemplateList)(
    (await shop.request('GET', '/emails/templates')).body,
  )
  return list.templates.find((t) => t.key === order)?.locales.find((l) => l.locale === locale)
    ?.override
}

test('the template list shows audience, placeholders and per-locale override state', async () => {
  await shop.request('PUT', `/emails/templates/${order}/locales/it`, {
    subject: 'Ordine {{order}}',
    body: '<p>Ciao</p>',
  })
  mount('/admin/emails/templates')

  await expect.poll(text).toContain(order)
  expect(document.querySelector('nav')?.textContent).toContain('Šablóny e-mailov')
  const row = [...document.querySelectorAll('tbody tr')]
    .map((r) => r.textContent ?? '')
    .find((r) => r.includes(order))
  expect(row).toContain('Verejnosť')
  expect(row).toContain('{{name}} {{order}}')
  expect(row).toContain('Angličtina: predvolené, Taliančina: upravené')
  expect(row).toContain('Zapnuté')
})

test('the editor saves an override, previews it and sends a test', async () => {
  mount(`/admin/emails/templates/${order}`)

  const subject = await expect
    .poll(() => document.querySelector<HTMLInputElement>('input[name="subject-en"]'))
    .toBeTruthy()
    .then(() => document.querySelector<HTMLInputElement>('input[name="subject-en"]')!)
  expect(subject.value).toBe('Order {{order}} confirmed')
  expect(text()).toContain('Predvolené znenie')

  subject.value = 'Objednávka {{order}} je potvrdená'
  subject.dispatchEvent(new Event('input'))
  await saveFromBar()
  await expect.poll(text).toContain('Šablóna bola uložená.')
  expect(await overrideOf('en')).toEqual({
    subject: 'Objednávka {{order}} je potvrdená',
    body: '<p>Thank you, {{name}}.</p>',
  })

  button('Náhľad').click()
  await expect
    .poll(() => document.querySelector('iframe')?.getAttribute('srcdoc') ?? '')
    .toContain('Thank you, Jana.')
  expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('')

  const sent = shop.mailer.sent.length
  button('Poslať mi test').click()
  await expect.poll(text).toContain('Testovací e-mail je na ceste k vám.')
  expect(shop.mailer.sent.slice(sent)).toEqual([
    expect.objectContaining({ to: ['eva@example.test'], subject: 'Objednávka A-1 je potvrdená' }),
  ])
})

test('the editor shows why the server rejected the wording', async () => {
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => document.querySelector('input[name="subject-en"]')).toBeTruthy()
  const subject = document.querySelector<HTMLInputElement>('input[name="subject-en"]')!
  subject.value = 'Hi {{nobody}}'
  subject.dispatchEvent(new Event('input'))
  await saveFromBar()
  await expect.poll(text).toContain('undeclared placeholder "nobody"')
})

test('placeholders insert into the body at the cursor', async () => {
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => document.querySelector('[contenteditable="true"]')).toBeTruthy()
  button('{{order}}').click()
  await saveFromBar()
  await expect.poll(text).toContain('Šablóna bola uložená.')
  expect((await overrideOf('en'))?.body).toContain('{{order}}')
})

const subjectField = (locale: string) =>
  document.querySelector<HTMLInputElement>(`input[name="subject-${locale}"]`)
const setSubject = (locale: string, value: string) => {
  subjectField(locale)!.value = value
  subjectField(locale)!.dispatchEvent(new Event('input'))
}
const testNote = 'Test použije uložené znenie'

test('the bar saves only the languages with changes, then goes away', async () => {
  const italian = { subject: 'Ordine {{order}}', body: '<p>Ciao</p>' }
  await shop.request('PUT', `/emails/templates/${order}/locales/it`, italian)
  writes.length = 0
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => subjectField('it')?.value).toBe('Ordine {{order}}')
  expect(bar()).toBeNull()
  expect(text()).not.toContain(testNote)

  setSubject('en', 'Order {{order}} is in')
  await expect.poll(bar).toBeTruthy()
  expect(text()).toContain(testNote)
  await saveFromBar()
  await expect.poll(text).toContain('Šablóna bola uložená.')
  await expect.poll(bar).toBeNull()
  expect(text()).not.toContain(testNote)
  expect(writes).toEqual([`PUT /api/emails/templates/${order}/locales/en`])
  expect((await overrideOf('en'))?.subject).toBe('Order {{order}} is in')
  expect(await overrideOf('it')).toEqual(italian)
})

test('a language the server refuses keeps its changes and shows why; the others save', async () => {
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => subjectField('it')).toBeTruthy()
  const italian = await overrideOf('it')
  setSubject('en', 'Order {{order}} is on its way')
  setSubject('it', 'Ciao {{nobody}}')
  await saveFromBar()
  await expect.poll(text).toContain('undeclared placeholder "nobody"')
  expect((await overrideOf('en'))?.subject).toBe('Order {{order}} is on its way')
  expect(await overrideOf('it')).toEqual(italian)
  // The refused language stays unsaved and its tab is shown.
  expect(bar()).toBeTruthy()
  expect(subjectField('it')!.value).toBe('Ciao {{nobody}}')
  await expect
    .poll(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent)
    .toContain('Taliančina')
})

test('the Send this email switch says whether the change was saved', async () => {
  mount(`/admin/emails/templates/${order}`)
  const toggle = () => document.querySelector<HTMLButtonElement>('button[role="switch"]')
  await expect.poll(() => toggle()?.getAttribute('aria-checked')).toBe('true')
  toggle()!.click()
  await expect.poll(text).toContain('Tento e-mail sa už neposiela.')
  expect(toggle()!.getAttribute('aria-checked')).toBe('false')

  failing = (request) => request.method === 'PUT' && request.url.endsWith('/enabled')
  toggle()!.click()
  await expect.poll(text).toContain('Posielanie sa nepodarilo zmeniť. Skúste to znova.')
  expect(toggle()!.getAttribute('aria-checked')).toBe('false')
})

const goTo = (path: string) => {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const discardDialog = () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
    d.textContent?.includes('Zahodiť neuložené zmeny?'),
  )
const inDialog = (label: string) =>
  [...(discardDialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  )

test('leaving while the first of two language saves runs asks; the fields wait meanwhile', async () => {
  const release = Promise.withResolvers<void>()
  onTestFinished(() => release.resolve())
  let held = false
  holding = (request) => {
    if (request.method !== 'PUT' || !request.url.endsWith('/locales/en')) return undefined
    held = true
    return release.promise
  }
  const editor = `/admin/emails/templates/${order}`
  mount(editor)
  await expect.poll(() => subjectField('it')).toBeTruthy()
  setSubject('en', 'Order {{order}}, held')
  setSubject('it', 'Ordine {{order}}, in attesa')
  await saveFromBar()
  await expect.poll(() => held).toBe(true)

  goTo('/admin/emails/templates')
  await expect.poll(discardDialog).toBeTruthy()
  inDialog('Pokračovať v úpravách')!.click()
  await expect.poll(() => location.pathname).toBe(editor)
  expect(subjectField('it')!.disabled).toBe(true)
  expect(subjectField('it')!.value).toBe('Ordine {{order}}, in attesa')

  release.resolve()
  await expect.poll(bar).toBeNull()
  expect((await overrideOf('en'))?.subject).toBe('Order {{order}}, held')
  expect((await overrideOf('it'))?.subject).toBe('Ordine {{order}}, in attesa')
  expect(subjectField('it')!.disabled).toBe(false)
})

test('Discard puts every language back', async () => {
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => subjectField('it')).toBeTruthy()
  const saved = { en: subjectField('en')!.value, it: subjectField('it')!.value }
  setSubject('en', 'Thrown away')
  setSubject('it', 'Buttato via')
  await expect.poll(bar).toBeTruthy()
  ;[...bar()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Zahodiť')!.click()
  await expect.poll(discardDialog).toBeTruthy()
  inDialog('Zahodiť zmeny')!.click()
  await expect.poll(bar).toBeNull()
  expect({ en: subjectField('en')!.value, it: subjectField('it')!.value }).toEqual(saved)
  expect(writes).toEqual([])
})
