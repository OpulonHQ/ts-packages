import { expect, test, vi } from 'vitest'
import { adminScope } from './admin-scope.ts'

const never = () => new Promise<never>(() => {})

test('a timed-out body cannot call a host, mount, poll or sleep into the next test', async () => {
  const timeout = new AbortController()
  const scope = adminScope(timeout.signal)
  const held = Promise.withResolvers<string>()
  const host = scope.host({ call: () => held.promise })
  const pending = host.call()
  const answer = Promise.withResolvers<boolean>()
  let asked = false
  const outcome = scope
    .poll(
      () => {
        asked = true
        return answer.promise
      },
      { timeout: 100 },
    )
    .toBe(true)
    .then(
      () => 'matched',
      () => 'failed',
    )
  await vi.waitFor(() => expect(asked).toBe(true))
  timeout.abort(new Error('Test timed out'))
  answer.resolve(true)
  expect(await outcome).toBe('failed')
  await expect(pending).rejects.toThrow('Test timed out')
  document.body.innerHTML = '<div id="next">next test</div>'
  expect(() => scope.mount('/admin', { fetch: never })).toThrow('Test timed out')
  expect(() => host.call()).toThrow('Test timed out')
  await expect(scope.poll(() => true, { timeout: 50 }).toBe(true)).rejects.toThrow()
  await expect(scope.sleep(1)).rejects.toThrow('Test timed out')
  held.resolve('late')
  await scope.close()
  expect(document.body.innerHTML).toBe('')
})

test('teardown releases held gates and unmounts even when the body failed before releasing', async () => {
  const scope = adminScope(new AbortController().signal)
  const gate = scope.gate()
  let served = 0
  const fetch: typeof globalThis.fetch = async () => {
    await gate.promise
    served++
    return new Response('{}')
  }
  scope.mount('/admin', { fetch })
  const request = scope.host({ fetch }).fetch('https://host.test/api/me')
  await scope.close()
  await expect(request).rejects.toThrow('the test has finished')
  expect(served).toBeGreaterThan(0)
  expect(document.querySelector('#app')).toBeNull()
})
