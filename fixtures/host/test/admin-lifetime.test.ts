import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from 'vitest'
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

let chained = 0
const chain = admin.track({
  first: () => later(),
  second: async () => {
    chained++
  },
})
test('a call chained after a timer still belongs to the test that started it', () => {
  void chain.first().then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await chain.second()
  })
})

test('the next test starts after the chained call settled', () => {
  expect(chained).toBe(1)
})

const failing = admin.track({
  fail: async () => {
    throw new Error('detached failure')
  },
})
test.fails('a tracked call that rejects unawaited fails its test', () => {
  void failing.fail()
})

const rejecting = admin.track({
  fail: async () => {
    throw new Error('expected failure')
  },
})
test('a tracked call the test expects to reject does not fail it', async () => {
  await expect(rejecting.fail()).rejects.toThrow('expected failure')
  await expect(rejecting.fail().then(() => {})).rejects.toThrow('expected failure')
  const caught = await rejecting.fail().catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(Error)
})

const derived = admin.track({
  value: async () => 'actual',
  fail: async () => {
    throw new Error('chained failure')
  },
})
test.fails('an assertion that fails in work chained on a tracked call fails its test', () => {
  void derived.value().then((value) => {
    expect(value).toBe('expected')
  })
})

test.fails('a tracked rejection passed on through a chained call fails its test', () => {
  void derived.fail().then(() => {})
})

let startedOnFailure = 0
const onFailure = admin.track({
  run: async () => {
    await later()
    startedOnFailure++
  },
})
test.fails('a failing test that chains tracked calls from onTestFailed', ({ onTestFailed }) => {
  onTestFailed(
    () =>
      void onFailure.run().then(async () => {
        await later()
        await onFailure.run()
      }),
  )
  expect('failed').toBe('passed')
})

test('the next test starts after the calls from onTestFailed settled', () => {
  expect(startedOnFailure).toBe(2)
})

describe('a call tracked before its test', () => {
  const early = admin.track({ value: async () => 1 })
  let call: Promise<number>
  beforeAll(() => {
    call = early.value()
  })
  test.fails('fails the test whose chained work fails', () => {
    void call.then((value) => {
      expect(value).toBe(2)
    })
  })
})

describe('after a call between tests rejected', () => {
  let settled = 0
  const host = admin.track({
    fail: async () => {
      throw new Error('between-test failure')
    },
    slow: async () => {
      await later()
      settled++
    },
  })
  afterEach(() => void host.slow())
  test.fails('a failing test whose onTestFailed call rejects', ({ onTestFailed }) => {
    onTestFailed(() => void host.fail())
    expect('failed').toBe('passed')
  })
  test.fails('the next test fails on that rejection', () => {})
  test('the test after it starts once the afterEach calls settled', () => {
    expect(settled).toBe(2)
  })
})

let ranAfterTimeout = false
test.fails('a test that times out', { timeout: 50 }, () => new Promise(() => {}))
test.fails('a later test is not run while the timed-out body may still run', () => {
  ranAfterTimeout = true
})
afterAll(() => expect(ranAfterTimeout).toBe(false))
