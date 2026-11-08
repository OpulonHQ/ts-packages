import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { defineCms, fields, type PageLocale } from '../src/api.ts'
import { refusedLocale } from '../src/admin/refused-locale.ts'
import { emptyLocale } from '../src/localize.ts'
import {
  checkFields,
  checkRequired,
  cleanData,
  cleanLocales,
  maxPathLength,
  normalizeDocument,
} from '../src/server/document.ts'

const locales = ['en', 'it']
const hero = {
  label: 'Hero',
  fields: {
    title: fields.text({ label: 'Title', required: true, maxLength: 5 }),
    cta: fields.link({ label: 'CTA' }),
    phone: fields.text({ label: 'Phone', localized: false, required: true }),
  },
}
const definitions = defineCms({ sections: { hero }, systemPages: {} })
const page = (own: Record<string, Partial<PageLocale>>, sections: Array<unknown> = []) => ({
  locales: Object.fromEntries(
    Object.entries(own).map(([code, value]) => [code, { ...emptyLocale(), ...value }]),
  ),
  sections,
})
const section = (data: Record<string, unknown>, type = 'hero') => ({
  id: crypto.randomUUID(),
  type,
  data,
})
const refusal = (effect: Effect.Effect<unknown, { message: string }>) =>
  Effect.runSync(Effect.flip(effect)).message
const normalize = (document: ReturnType<typeof page>) =>
  normalizeDocument(definitions, locales, document as never)

test.each([
  [
    'a path where the items have none',
    () => refusal(cleanLocales(locales, page({ it: { path: '/ciao' } }).locales, false)),
    'it',
  ],
  [
    'a default-locale path under another locale prefix (names both)',
    () => refusal(normalize(page({ en: { path: '/it' } }))),
    'en',
  ],
  ['a malformed path', () => refusal(normalize(page({ it: { path: '/Ciao Mondo' } }))), 'it'],
  [
    'a path over the length limit',
    () => refusal(normalize(page({ it: { path: `/${'a'.repeat(maxPathLength)}` } }))),
    'it',
  ],
  ['available without a path', () => refusal(normalize(page({ it: { available: true } }))), 'it'],
  [
    'a social image that is no media id',
    () => refusal(normalize(page({ it: { seo: { ...emptyLocale().seo, image: 'not-an-id' } } }))),
    'it',
  ],
  [
    "a section value over its schema's limit",
    () => refusal(normalize(page({}, [section({ title: { it: 'Troppo lungo' } })]))),
    'it',
  ],
  [
    "a collection value over its schema's limit",
    () => refusal(cleanData(definitions, hero, { title: { it: 'Troppo lungo' } }, locales)),
    'it',
  ],
  [
    'a required value missing in the default locale',
    () => refusal(checkFields(hero, 'en', { title: { it: 'Ciao' }, phone: '1' })),
    'en',
  ],
  [
    'a section missing a required value in the default locale, on publish',
    () =>
      refusal(
        checkRequired(definitions, 'en', page({}, [section({ title: { it: 'Ciao' } })]) as never),
      ),
    'en',
  ],
  [
    'a menu entry without a label in the default locale (server/site.ts)',
    () => 'Menu item 1.2 needs a label in en.',
    'en',
  ],
  [
    'a required value every locale shares',
    () => refusal(checkFields(hero, 'en', { title: { en: 'Hi' } })),
    undefined,
  ],
  [
    'a link that points nowhere',
    () => refusal(cleanData(definitions, hero, { cta: { type: 'url', url: 'in it.' } }, locales)),
    undefined,
  ],
  [
    'an unknown section type',
    () => refusal(normalize(page({}, [section({}, 'missing')]))),
    undefined,
  ],
  [
    'too many sections',
    () =>
      refusal(
        normalize(
          page(
            {},
            Array.from({ length: 201 }, () => section({})),
          ),
        ),
      ),
    undefined,
  ],
])('%s', (_, message, expected) => {
  expect(refusedLocale(message(), locales)).toBe(expected)
})

test('the messages are the ones the editor parses', () => {
  expect(refusal(normalize(page({ en: { path: '/it' } })))).toBe(
    'The en path "/it" starts with "/it", the prefix of it pages.',
  )
  expect(refusal(checkFields(hero, 'en', { title: { it: 'Ciao' }, phone: '1' }))).toBe(
    '"Title" is required in en.',
  )
  expect(refusal(normalize(page({}, [section({ title: { it: 'Troppo lungo' } })])))).toMatch(
    /^Section 1 \(Hero\): .*\n\s+at \["title"\]\["it"\]$/,
  )
})
