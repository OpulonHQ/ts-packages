import { afterAll, expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const admin = useAdminLifetime()
const stuck = admin.track({ wait: () => new Promise<never>(() => {}) })
let ranAfterDrain = false

test.fails('a call still pending 5s after its test fails that test', () => {
  void stuck.wait()
})

test.fails('a later test is not run after a failed drain', () => {
  ranAfterDrain = true
})

afterAll(() => expect(ranAfterDrain).toBe(false))
