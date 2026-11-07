import { expect, test } from 'vitest'
import { formatDate, formatDateTime, languageName } from '../src/format.ts'

test('a language name starts with a capital, in its own language by default', () => {
  expect(languageName('sk')).toBe('Slovenčina')
  expect(languageName('en')).toBe('English')
  expect(languageName('en', 'sk')).toBe('Angličtina')
})

test('an unknown code falls back to the code itself', () => {
  expect(languageName('zz')).toBe('zz')
})

test('dates read the same on every list: a medium day, or a medium day and short time', () => {
  const moment = '2026-11-07T13:37:00Z'
  expect(formatDate(moment, 'en')).toBe('Nov 7, 2026')
  expect(formatDateTime(new Date(2026, 10, 7, 14, 37), 'en')).toBe('Nov 7, 2026, 2:37 PM')
  expect(formatDate(moment, 'sk')).toBe('7. 11. 2026')
})

test('a missing or unreadable date shows the empty placeholder', () => {
  for (const value of [null, undefined, '', 'not a date']) {
    expect(formatDate(value, 'en')).toBe('—')
    expect(formatDateTime(value, 'en')).toBe('—')
  }
})
