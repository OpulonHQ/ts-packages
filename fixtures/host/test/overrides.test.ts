import { EmailTemplateList } from '@opulonjs/emails/api'
import { Schema } from 'effect'
import { expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeShop } from './support/shop.ts'

const db = useTestDatabase()
const shop = makeShop(() => db.url)
const order = 'shop.order_confirmed'

const list = async () =>
  Schema.decodeUnknownSync(EmailTemplateList)((await shop.request('GET', '/emails/templates')).body)
const template = async (key: string) => (await list()).templates.find((t) => t.key === key)!
const save = (locale: string, content: { subject: string; body: string }, key = order) =>
  shop.request('PUT', `/emails/templates/${key}/locales/${locale}`, content)
const reset = (locale: string, key = order) =>
  shop.request('DELETE', `/emails/templates/${key}/locales/${locale}`)
const setEnabled = (enabled: boolean, key = order) =>
  shop.request('PUT', `/emails/templates/${key}/enabled`, { enabled })
const audit = (action: string) =>
  adminQuery<{ subject_id: string; actor_id: string; context: { locale?: string } | null }>(
    db.url,
    `select subject_id, actor_id, context from core.audit_event where action = '${action}'
      order by id`,
  )
/** The emails sent by `run`. */
const sentBy = async (run: () => Promise<unknown>) => {
  const before = shop.mailer.sent.length
  await run()
  return shop.mailer.sent.slice(before)
}

test('the template list shows key, audience, placeholders and per-locale override state', async () => {
  const { templates, components } = await list()
  expect(templates.map((t) => t.key)).toEqual(['shop.order_confirmed', 'shop.staff_alert'])
  expect(await template(order)).toMatchObject({
    audience: 'public',
    enabled: true,
    placeholders: [
      { name: 'name', sample: 'Jana' },
      { name: 'order', sample: 'A-1' },
    ],
    locales: [
      {
        locale: 'en',
        default: { subject: 'Order {{order}} confirmed', body: '<p>Thank you, {{name}}.</p>' },
        override: null,
      },
      { locale: 'it', override: null },
    ],
  })
  // Staff templates are edited in the admin locales.
  expect((await template('shop.staff_alert')).locales.map((l) => l.locale)).toEqual(['en', 'sk'])
  // Package defaults plus the host's component.
  expect(components.map((c) => c.name)).toEqual(['button', 'callout', 'divider', 'table', 'coupon'])
  expect(components.find((c) => c.name === 'button')?.props).toEqual([
    { name: 'label', kind: 'text' },
    { name: 'href', kind: 'url' },
  ])
})

test('an override is sanitized to the restricted format on save and audited', async () => {
  const { status, body } = await save('en', {
    subject: 'Your order {{order}}',
    body:
      '<p onclick="x()">Hi <strong>{{name}}</strong><script>alert(1)</script>' +
      '<img src="https://evil.test/x.png"> <a href="javascript:alert(1)">bad</a> ' +
      '<a href="{{order}}" style="color:red">ok</a></p>',
  })
  expect(status).toBe(200)
  expect(body).toEqual({
    subject: 'Your order {{order}}',
    body: '<p>Hi <strong>{{name}}</strong> <a>bad</a> <a href="{{order}}">ok</a></p>',
  })
  const en = (await template(order)).locales.find((l) => l.locale === 'en')
  expect(en?.override).toEqual(body)
  expect((await template(order)).locales.find((l) => l.locale === 'it')?.override).toBeNull()
  expect(await audit('emails.template.overridden')).toEqual([
    { subject_id: order, actor_id: 'u1', context: { locale: 'en' } },
  ])
})

test('sends use the override, with components rendered and values escaped', async () => {
  await save('en', {
    subject: 'Your order {{order}}',
    body:
      '<p>Hi {{name}}</p><p>[[button label="Track {{order}}" href="https://shop.example.test/o/{{order}}"]]</p>' +
      '<p>[[coupon code="SAVE-{{name}}"]]</p><p>[[button label="Bad" href="{{name}}"]]</p>',
  })
  const [email] = await sentBy(() => shop.order({ name: '<i>Jana</i>' }))
  expect(email?.subject).toBe('Your order A-7')
  expect(email?.html).toContain('Hi &lt;i&gt;Jana&lt;/i&gt;')
  expect(email?.html).toContain('href="https://shop.example.test/o/A-7"')
  expect(email?.html).toContain('Track A-7')
  expect(email?.html).toContain('<div class="coupon">SAVE-&lt;i&gt;Jana&lt;/i&gt;</div>')
  // A URL prop whose value is not an http(s) or mailto URL renders without a link.
  expect(email?.html).not.toContain('href="&lt;i&gt;')
  expect(email?.html).not.toContain('<p><table')
  expect(email?.text).toContain('Track A-7 (https://shop.example.test/o/A-7)')

  // Locales without an override keep the default.
  const [italian] = await sentBy(() => shop.order({ locale: 'it' }))
  expect(italian?.subject).toBe('Ordine A-7 confermato')
})

test('a placeholder value in a link href must be a safe URL', async () => {
  await save('it', { subject: 'S', body: '<p><a href="{{name}}">x</a></p>' })
  const [email] = await sentBy(() => shop.order({ name: 'javascript:alert(1)', locale: 'it' }))
  expect(email?.html).not.toContain('javascript:')
  expect(email?.html).toContain('<a href="">x</a>')
  await reset('it')
})

test('save rejects undeclared placeholders, unknown components and foreign locales', async () => {
  const invalid = [
    await save('en', { subject: 'Hi {{nobody}}', body: '<p>x</p>' }),
    await save('en', { subject: 'Hi', body: '<p>{{secret}}</p>' }),
    await save('en', { subject: 'Hi', body: '<p>[[rocket fuel="1"]]</p>' }),
    await save('en', { subject: 'Hi', body: '<p>[[button colour="red"]]</p>' }),
    await save('en', { subject: '', body: '<p>x</p>' }),
    await save('sk', { subject: 'Hi', body: '<p>x</p>' }),
  ]
  expect(invalid.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400])
  expect(invalid[0]?.body.message).toContain('nobody')
  expect(invalid[2]?.body.message).toContain('rocket')
  expect((await save('en', { subject: 'Hi', body: '<p>x</p>' }, 'shop.nothing')).status).toBe(404)
})

test('preview renders unsaved wording with the sample values', async () => {
  const { status, body } = await shop.request('POST', `/emails/templates/${order}/preview`, {
    locale: 'it',
    subject: 'Anteprima {{order}}',
    body: '<p>Ciao {{name}}</p><p>[[divider]]</p><script>x</script>',
  })
  expect(status).toBe(200)
  expect(body.subject).toBe('Anteprima A-1')
  expect(body.html).toContain('<p>Ciao Jana</p>')
  expect(body.html).toContain('<hr')
  expect(body.html).not.toContain('<script')
  expect(body.html).toContain('<html lang="it">')
})

test('a test send goes through the outbox to the current user and is audited', async () => {
  const emails = await sentBy(async () => {
    const { status, body } = await shop.request('POST', `/emails/templates/${order}/test`, {
      locale: 'en',
    })
    expect(status).toBe(200)
    expect((await shop.log()).rows.find((r) => r.id === body.id)).toMatchObject({
      templateKey: order,
      recipients: ['eva@example.test'],
      status: 'sent',
    })
  })
  expect(emails).toEqual([
    expect.objectContaining({ to: ['eva@example.test'], subject: 'Your order A-1' }),
  ])
  expect(await audit('emails.template.test_sent')).toEqual([
    { subject_id: order, actor_id: 'u1', context: { locale: 'en' } },
  ])
})

test('reset returns to the default wording', async () => {
  expect((await reset('en')).status).toBe(204)
  expect((await template(order)).locales.every((l) => l.override === null)).toBe(true)
  const [email] = await sentBy(() => shop.order({}))
  expect(email?.subject).toBe('Order A-7 confirmed')
  expect(await audit('emails.template.reset')).toHaveLength(2)
})

test('a disabled template is logged as skipped and not sent', async () => {
  expect((await setEnabled(false)).status).toBe(204)
  expect((await template(order)).enabled).toBe(false)
  const emails = await sentBy(async () => {
    const { body } = await shop.order({})
    expect((await shop.log()).rows.find((r) => r.id === body.id)).toMatchObject({
      status: 'skipped',
      attempts: 0,
    })
  })
  expect(emails).toEqual([])
  // Other templates still go out.
  expect(await sentBy(() => shop.request('POST', '/shop/alerts'))).toHaveLength(1)

  await setEnabled(true)
  expect(await sentBy(() => shop.order({}))).toHaveLength(1)
  expect((await audit('emails.template.disabled')).length).toBe(1)
  expect((await audit('emails.template.enabled')).length).toBe(1)
})

test('managing templates needs emails.templates.manage', async () => {
  const forbidden = await shop.request('GET', '/emails/templates', undefined, null, [
    'emails.log.view',
  ])
  expect(forbidden.status).toBe(403)
})
