import { composeServer, core, CompositionError, defineModule } from '@opulonjs/core'
import { emails, emailTemplate } from '@opulonjs/emails/server'
import { Layer } from 'effect'
import { expect, test } from 'vitest'

const welcome = (key: string) =>
  emailTemplate({
    key,
    audience: 'public',
    placeholders: { name: 'Jana' },
    defaults: { en: { subject: 'Welcome {{name}}', body: '<p>Hi {{name}}</p>' } },
  })

const contributor = (id: string, keys: ReadonlyArray<string>, dependsOn = ['emails']) =>
  defineModule({
    id,
    dependsOn,
    groups: [],
    handlers: () => Layer.empty,
    contributes: keys.map(welcome),
  })

const mail = emails({ from: 'noreply@example.test', brand: { name: 'Test' } })

const fails = (modules: Parameters<typeof composeServer>[0]['modules'], message: RegExp) =>
  expect(() => composeServer({ modules })).toThrow(
    expect.objectContaining({
      name: CompositionError.name,
      message: expect.stringMatching(message),
    }),
  )

test('composition accepts templates from modules depending on emails', () => {
  expect(() =>
    composeServer({ modules: [core(), mail, contributor('shop', ['shop.welcome'])] }),
  ).not.toThrow()
})

test('composition rejects a duplicate template key', () =>
  fails(
    [core(), mail, contributor('shop', ['shop.welcome', 'shop.welcome'])],
    /shop: duplicate emailTemplate "shop.welcome"/,
  ))

test('composition rejects templates when the emails module is missing', () =>
  fails(
    [core(), contributor('shop', ['shop.welcome'], [])],
    /shop: contributes emailTemplate "shop.welcome", but its owner "emails" is not composed/,
  ))

test('composition rejects a contributor without dependsOn on emails', () =>
  fails(
    [core(), mail, contributor('shop', ['shop.welcome'], [])],
    /shop: contributes emailTemplate "shop.welcome", so it must list "emails" in dependsOn/,
  ))

test('a template whose wording uses an undeclared placeholder fails at startup', () => {
  expect(() =>
    emailTemplate({
      key: 'shop.broken',
      audience: 'staff',
      placeholders: { name: 'Jana' },
      defaults: { en: { subject: 'Hi {{name}}', body: '<p>{{secret}}</p>' } },
    }),
  ).toThrow('email template "shop.broken" (en) uses undeclared placeholder "secret"')
})
