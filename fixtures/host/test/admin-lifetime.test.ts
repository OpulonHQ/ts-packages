import { expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const admin = useAdminLifetime()
let served = 0

test('a test can end while its admin waits on a held request', () => {
  const gate = admin.gate()
  admin.mount('/admin/', {
    fetch: async () => {
      await gate.promise
      await new Promise((resolve) => setTimeout(resolve, 50))
      served++
      return new Response('', { status: 401 })
    },
  })
  expect(document.querySelector('#app')).toBeTruthy()
})

test('the next test starts after that admin unmounted and its requests settled', () => {
  expect(served).toBeGreaterThan(0)
  expect(document.body.innerHTML).toBe('')
})
