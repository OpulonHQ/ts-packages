import { afterAll, expect, onTestFinished, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const admin = useAdminLifetime()
const later = () => new Promise((resolve) => setTimeout(resolve, 50))
let served = 0
let cleaned = 0
const host = admin.track({
  cleanup: async () => {
    await later()
    cleaned++
  },
})

test('a test can end while its admin waits on a held request', () => {
  const gate = admin.gate()
  admin.mount('/admin/', {
    fetch: async () => {
      await gate.promise
      await later()
      served++
      return new Response('', { status: 401 })
    },
  })
  onTestFinished(() => void host.cleanup())
  expect(document.querySelector('#app')).toBeTruthy()
})

test('the next test starts after that admin unmounted and its requests and cleanup settled', () => {
  expect(served).toBeGreaterThan(0)
  expect(cleaned).toBe(1)
  expect(document.body.innerHTML).toBe('')
})

let ranAfterTimeout = false
test.fails('a test that times out', { timeout: 50 }, () => new Promise(() => {}))
test.fails('a later test is not run while the timed-out body may still run', () => {
  ranAfterTimeout = true
})
afterAll(() => expect(ranAfterTimeout).toBe(false))
