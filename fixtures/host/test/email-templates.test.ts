import { defineAdminModule } from '@opulonjs/admin'
import { EmailTemplateList } from '@opulonjs/emails/api'
import { emailsAdmin } from '@opulonjs/emails/admin'
import { Schema } from 'effect'
import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeShop } from './support/shop.ts'

// Runs in the `admin` vitest project: the email template screens mounted in happy-dom, their
// fetch routed into the shop worker (signed in as Eva, admin locale sk). No mocked API.
const admin = useAdminLifetime()
const db = useTestDatabase()
const shop = admin.track(makeShop(() => db.url))
const order = 'shop.order_confirmed'

const hostFetch: typeof fetch = async (input, init) => {
  const pending: Array<Promise<unknown>> = []
  const response = await shop.fetch(new Request(input, init), (p) => pending.push(p))
  const body = await response.arrayBuffer()
  await Promise.all(pending)
  return new Response(body, response)
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
  expect(row).toContain('en: predvolené, it: upravené')
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
  button('Uložiť').click()
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
  button('Uložiť').click()
  await expect.poll(text).toContain('undeclared placeholder "nobody"')
})

test('placeholders insert into the body at the cursor', async () => {
  mount(`/admin/emails/templates/${order}`)
  await expect.poll(() => document.querySelector('[contenteditable="true"]')).toBeTruthy()
  button('{{order}}').click()
  button('Uložiť').click()
  await expect.poll(text).toContain('Šablóna bola uložená.')
  expect((await overrideOf('en'))?.body).toContain('{{order}}')
})
