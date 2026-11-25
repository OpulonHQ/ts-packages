import { expect, test } from 'vitest'
import { shellMessages } from '../../../packages/admin/src/messages.ts'
import { kitTexts } from '../../../packages/ui/src/text.ts'

type Catalog = { readonly [key: string]: unknown }

const keys = (catalog: Catalog, prefix = ''): ReadonlyArray<string> =>
  Object.entries(catalog).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? keys(value as Catalog, `${prefix}${key}/`)
      : [`${prefix}${key}`],
  )

const files = import.meta.glob<Catalog>(
  [
    '../../../packages/*/src/admin/messages/*.ts',
    '../../../packages/admin/src/messages/cache-purges/*.ts',
  ],
  { eager: true, import: 'default' },
)
const byDirectory: Record<string, Record<string, Catalog>> = {}
for (const [path, catalog] of Object.entries(files)) {
  const [, directory, locale] = /^(.*)\/(\w+)\.ts$/.exec(path)!
  ;(byDirectory[directory!] ??= {})[locale!] = catalog
}

const catalogs: Record<string, Readonly<Record<string, Catalog>>> = {
  shell: shellMessages,
  kit: kitTexts,
  ...byDirectory,
}

test('finds the catalogs of the shell, the kit, the cache notice and the four package modules', () => {
  expect(Object.keys(catalogs)).toHaveLength(7)
})

test.for(Object.entries(catalogs))(
  '%s has Slovak and Italian catalogs with exactly the English keys',
  ([, locales]) => {
    expect(Object.keys(locales).sort()).toEqual(['en', 'it', 'sk'])
    const english = [...keys(locales.en!)].sort()
    expect([...keys(locales.sk!)].sort()).toEqual(english)
    expect([...keys(locales.it!)].sort()).toEqual(english)
  },
)
