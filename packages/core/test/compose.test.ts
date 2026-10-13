import { Effect, Layer, Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { describe, expect, test } from 'vitest'
import {
  Authorization,
  composeServer,
  CompositionError,
  type Contribution,
  defineExtensionPoint,
  type Module,
  Policy,
  Public,
} from '../src/index.ts'

const ping = HttpApiEndpoint.get('ping', '/ping', { success: Schema.String })
const authed = ping.middleware(Authorization)

// Composition checks never build handlers, so the test modules skip them (and defineModule's
// key types, which would reject the bad keys these tests need).
const module = (
  id: string,
  options: {
    dependsOn?: ReadonlyArray<string>
    group?: HttpApiGroup.Constraint
    permissions?: ReadonlyArray<string>
    auditActions?: ReadonlyArray<string>
    tasks?: ReadonlyArray<string>
    contributes?: ReadonlyArray<Contribution>
  } = {},
): Module => ({
  id,
  dependsOn: options.dependsOn ?? [],
  groups: [options.group ?? HttpApiGroup.make(id).add(ping).annotate(Public, true)],
  handlers: () => Layer.empty,
  layer: undefined,
  migrations: {},
  permissions: options.permissions ?? [],
  auditActions: (options.auditActions ?? []).map((key) => ({ key, subject: 'thing' })),
  tasks: (options.tasks ?? []).map((name) => ({ name, every: '5m', run: Effect.void })),
  contributes: options.contributes ?? [],
})

// An extension point owned by `shop`; other modules contribute discounts to it.
const discounts = defineExtensionPoint<{ readonly key: string; readonly percent: number }>(
  'shop',
  'discount',
)

const protectedGroup = (id: string, endpoint: HttpApiEndpoint.Constraint) =>
  HttpApiGroup.make(id).add(endpoint)
const fails = (modules: ReadonlyArray<Module>, message: RegExp) =>
  expect(() => composeServer({ modules })).toThrow(
    expect.objectContaining({
      name: CompositionError.name,
      message: expect.stringMatching(message),
    }),
  )

describe('composeServer fails at startup on', () => {
  test('a duplicate module id', () =>
    fails([module('demo'), module('demo')], /duplicate module id "demo"/))

  test('an invalid module id', () => fails([module('Demo')], /module id "Demo" must match/))

  test('an unknown dependsOn', () =>
    fails([module('cms', { dependsOn: ['media'] })], /cms: dependsOn unknown module "media"/))

  test('a dependency cycle', () =>
    fails(
      [module('a', { dependsOn: ['b'] }), module('b', { dependsOn: ['a'] })],
      /dependency cycle among modules: a, b/,
    ))

  test('a permission outside the module prefix', () =>
    fails(
      [module('demo', { permissions: ['cms.pages.edit'] })],
      /demo: permission "cms.pages.edit" is outside/,
    ))

  test('an audit action outside the module prefix', () =>
    fails(
      [module('demo', { auditActions: ['auth.signed_in'] })],
      /demo: audit action "auth.signed_in" is outside/,
    ))

  test('a duplicate task name within a module', () =>
    fails(
      [module('demo', { tasks: ['sweep', 'purge', 'sweep'] })],
      /demo: duplicate task name "sweep"/,
    ))

  test('an API group outside the module prefix', () =>
    fails(
      [module('demo', { group: HttpApiGroup.make('other').add(ping).annotate(Public, true) })],
      /API group "other"/,
    ))

  test('a non-public endpoint without the Authorization middleware', () =>
    fails(
      [
        module('demo', {
          permissions: ['demo.view'],
          group: protectedGroup('demo', ping.annotate(Policy, 'demo.view')),
        }),
      ],
      /demo.ping: non-public endpoint without the Authorization middleware/,
    ))

  test('a non-public endpoint without a policy', () =>
    fails(
      [module('demo', { group: protectedGroup('demo', authed) })],
      /demo.ping: non-public endpoint without a Policy/,
    ))

  test('a policy key missing from the composed catalog', () =>
    fails(
      [module('demo', { group: protectedGroup('demo', authed.annotate(Policy, 'demo.view')) })],
      /demo.ping: policy "demo.view" is not a composed permission/,
    ))

  test('a public group with the Authorization middleware', () =>
    fails(
      [
        module('demo', {
          group: HttpApiGroup.make('demo').add(ping).middleware(Authorization).annotate(Public, true),
        }),
      ],
      /demo.ping: public endpoint with the Authorization middleware/,
    ))

  test('a public group with a Policy', () =>
    fails(
      [
        module('demo', {
          group: HttpApiGroup.make('demo')
            .add(ping.annotate(Policy, 'signedIn'))
            .annotate(Public, true),
        }),
      ],
      /demo.ping: public endpoint with a Policy/,
    ))

  test.each([
    [[], /contentLocales must list at least one locale/],
    [['en', 'English'], /content locale "English" must be a language tag/],
    [['en', 'it', 'en'], /contentLocales lists a locale twice/],
  ])('content locales %j', (contentLocales, message) =>
    expect(() => composeServer({ modules: [module('demo')], contentLocales })).toThrow(message),
  )
})

describe('composeServer rejects contributions', () => {
  test('with a duplicate key', () =>
    fails(
      [
        module('shop'),
        module('promo', {
          dependsOn: ['shop'],
          contributes: [
            discounts.contribute({ key: 'promo.summer', percent: 10 }),
            discounts.contribute({ key: 'promo.summer', percent: 20 }),
          ],
        }),
      ],
      /promo: duplicate discount "promo.summer"/,
    ))

  test('to an owner that is not composed', () =>
    fails(
      [module('promo', { contributes: [discounts.contribute({ key: 'promo.x', percent: 1 })] })],
      /promo: contributes discount "promo.x", but its owner "shop" is not composed/,
    ))

  test('from a module that does not depend on the owner', () =>
    fails(
      [
        module('shop'),
        module('promo', { contributes: [discounts.contribute({ key: 'promo.x', percent: 1 })] }),
      ],
      /promo: contributes discount "promo.x", so it must list "shop" in dependsOn/,
    ))

  test('with a key outside the contributor prefix', () =>
    fails(
      [
        module('shop'),
        module('promo', {
          dependsOn: ['shop'],
          contributes: [discounts.contribute({ key: 'shop.x', percent: 1 })],
        }),
      ],
      /promo: discount "shop.x" is outside the module prefix/,
    ))
})

describe('composeServer accepts', () => {
  test('contributions, which the owner collects frozen in module order', async () => {
    const server = composeServer({
      modules: [
        module('promo', {
          dependsOn: ['shop'],
          contributes: [discounts.contribute({ key: 'promo.summer', percent: 10 })],
        }),
        module('shop', { contributes: [discounts.contribute({ key: 'shop.staff', percent: 5 })] }),
      ],
    })
    const collected = await Effect.runPromise(
      discounts.collect.pipe(Effect.provide(server.services as Layer.Layer<never>)),
    )
    expect(collected).toEqual([
      { key: 'shop.staff', percent: 5 },
      { key: 'promo.summer', percent: 10 },
    ])
    expect(Object.isFrozen(collected)).toBe(true)
    expect(Object.isFrozen(collected[0])).toBe(true)
  })

  test('protected endpoints with a composed or signedIn policy, ordering modules by dependsOn and allowing one task name in different modules', () => {
    const server = composeServer({
      modules: [
        module('cms', {
          dependsOn: ['media'],
          permissions: ['cms.view'],
          group: protectedGroup('cms', authed.annotate(Policy, 'cms.view')),
        }),
        module('media', { group: protectedGroup('media', authed.annotate(Policy, 'signedIn')) }),
        module('demo', { tasks: ['sweep'] }),
        module('other', { tasks: ['sweep'] }),
      ],
    })
    expect(server.modules.map((m) => m.id)).toEqual(['media', 'cms', 'demo', 'other'])
  })
})
