import { expect, test } from 'vitest'
import { languageName } from '../src/format.ts'

test('a language name starts with a capital, in its own language by default', () => {
  expect(languageName('sk')).toBe('Slovenčina')
  expect(languageName('en')).toBe('English')
  expect(languageName('en', 'sk')).toBe('Angličtina')
})

test('an unknown code falls back to the code itself', () => {
  expect(languageName('zz')).toBe('zz')
})
