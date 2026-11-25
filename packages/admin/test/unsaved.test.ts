import { expect, test } from 'vitest'
import { sameContent } from '../src/index.ts'

test('a picked file is a change, and the same file is not', () => {
  const scan = new File(['hello'], 'scan.pdf', { type: 'application/pdf', lastModified: 1 })
  expect(sameContent({ scan: null }, { scan })).toBe(false)
  expect(sameContent({ scan }, { scan })).toBe(true)
  expect(
    sameContent({ scan }, { scan: new File(['other'], 'other.pdf', { lastModified: 1 }) }),
  ).toBe(false)
})
