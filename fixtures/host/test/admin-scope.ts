import { type AdminOptions, createAdmin } from '@opulonjs/admin'
import { test as base, expect } from 'vitest'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'

/**
 * One admin journey's lifetime. Vitest does not cancel a timed-out test body, so once the test
 * has finished every host call, mount, poll and sleep made through the scope throws, and pending
 * ones reject: a late body cannot reach the next test's DOM or data. `close` unmounts, releases
 * the scope's gates and waits for every request it started, failing if one is still pending 5s later.
 */
export const adminScope = (signal: AbortSignal) => {
  const controller = new AbortController()
  const stop = () => controller.abort(signal.reason ?? new Error('the test has finished'))
  signal.addEventListener('abort', stop, { once: true })
  const stopped = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    }),
  )
  stopped.catch(() => {})
  const pending = new Set<Promise<unknown>>()
  const gates = new Set<() => void>()
  const apps: Array<{ unmount: () => void }> = []
  const wait = <T>(work: Promise<T>): Promise<T> => {
    if (!controller.signal.aborted) {
      pending.add(work)
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work),
      )
    }
    const raced = Promise.race([work, stopped])
    raced.catch(() => {})
    return raced
  }
  return {
    host: <Host extends object>(host: Host): Host =>
      new Proxy(host, {
        get: (target, key, receiver) => {
          const value: unknown = Reflect.get(target, key, receiver)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            controller.signal.throwIfAborted()
            const result: unknown = Reflect.apply(value, target, args)
            return result instanceof Promise ? wait(result) : result
          }
        },
      }),
    sleep: (ms: number) => wait(new Promise<void>((resolve) => setTimeout(resolve, ms))),
    gate: () => {
      const gate = Promise.withResolvers<void>()
      gates.add(gate.resolve)
      return gate
    },
    poll: <T>(actual: () => T, options?: Parameters<typeof expect.poll>[1]) =>
      expect.poll(() => {
        controller.signal.throwIfAborted()
        return actual()
      }, options),
    mount: (
      path: string,
      {
        fetch,
        modules = adminModules,
      }: { fetch: typeof globalThis.fetch; modules?: AdminOptions['modules'] },
    ) => {
      controller.signal.throwIfAborted()
      history.replaceState(null, '', path)
      document.body.innerHTML = '<div id="app"></div>'
      const app = createAdmin({
        brand,
        modules,
        buildId: 'build-1',
        fetch: (input, init) => wait(controller.signal.aborted ? stopped : fetch(input, init)),
      })
      app.mount('#app')
      apps.push(app)
      return () => document.body.textContent ?? ''
    },
    close: async () => {
      stop()
      for (const app of apps) app.unmount()
      for (const release of gates) release()
      const drained = (async () => {
        while (pending.size > 0) await Promise.allSettled([...pending])
      })()
      const limit = Promise.withResolvers<void>()
      const timer = setTimeout(limit.resolve, 5000)
      await Promise.race([drained, limit.promise])
      clearTimeout(timer)
      document.body.replaceChildren()
      if (pending.size > 0)
        throw new Error(`${pending.size} request(s) still pending 5s after the test finished`)
    },
  }
}

export const test = base.extend<{ scope: ReturnType<typeof adminScope> }>({
  scope: async ({ signal }, use) => {
    const scope = adminScope(signal)
    await use(scope)
    await scope.close()
  },
})
