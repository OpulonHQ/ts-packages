import { type AdminOptions, createAdmin } from '@opulonjs/admin'
import { beforeEach } from 'vitest'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'

// `await` adopts a plain Promise without calling `then`, so only a subclass sees every consumer.
class Watched<T> extends Promise<T> {
  observed = false
  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.observed = true
    return super.then(onFulfilled, onRejected)
  }
}

/**
 * Admin journeys for one test file. When a test finishes, after its own cleanup callbacks, the
 * mounted admins unmount, the test's gates open and every call the admins or a `track`ed host
 * started settles, including calls chained within one timer tick (failing after 5s). A tracked
 * call that rejected while nothing awaited or caught it fails the test that started it. Calls
 * started between tests (`beforeAll`, `onTestFailed`) settle before the next test starts.
 * Vitest does not cancel a timed-out test body or hook, so once a test or its hooks time out,
 * its calls do not settle or an admin fails to unmount, no later test in the file runs: a late
 * body cannot reach another test's DOM, URL or data.
 */
export const useAdminLifetime = () => {
  type Lifetime = {
    readonly name: string
    readonly apps: Array<{ unmount: () => void }>
    readonly gates: Array<() => void>
    readonly pending: Array<Promise<unknown>>
    readonly rejected: Array<{ readonly call: Watched<unknown>; readonly error: unknown }>
  }
  const fresh = (name: string): Lifetime => ({
    name,
    apps: [],
    gates: [],
    pending: [],
    rejected: [],
  })
  let current = fresh('before the first test')
  let unfinished: string | undefined
  let previous: { readonly signal: AbortSignal; readonly name: string } | undefined
  const tracked =
    (fn: Parameters<typeof Reflect.apply>[0], self: unknown) =>
    (...args: unknown[]): unknown => {
      const result: unknown = Reflect.apply(fn, self, args)
      if (result instanceof Promise) {
        const { pending, rejected } = current
        pending.push(result)
        const call = new Watched((resolve, reject) => {
          result.then(resolve, reject)
        })
        Promise.prototype.then.call(call, undefined, (error: unknown) =>
          rejected.push({ call, error }),
        )
        return call
      }
      return typeof result === 'function' ? tracked(result, undefined) : result
    }

  const settle = async ({ pending }: Lifetime) => {
    let settled = false
    const drained = (async () => {
      let seen = 0
      do {
        for (; seen < pending.length; seen++)
          await pending[seen]?.then(
            () => {},
            () => {},
          )
        await new Promise((resolve) => setTimeout(resolve, 0))
      } while (seen < pending.length)
      settled = true
    })()
    const limit = Promise.withResolvers<void>()
    const timer = setTimeout(limit.resolve, 5000)
    await Promise.race([drained, limit.promise])
    clearTimeout(timer)
    return settled
  }

  const close = async (lifetime: Lifetime) => {
    const failures: Array<unknown> = []
    let clean = false
    try {
      for (const app of lifetime.apps) {
        try {
          app.unmount()
        } catch (error) {
          failures.push(error)
        }
      }
      for (const release of lifetime.gates) release()
      const settled = await settle(lifetime)
      document.body.replaceChildren()
      if (!settled)
        throw new Error(`admin or host calls from ${lifetime.name} still pending after 5s`)
      clean = failures.length === 0
    } finally {
      if (!clean) unfinished ??= lifetime.name
    }
    for (const { call, error } of lifetime.rejected) if (!call.observed) failures.push(error)
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `an unmount or an unhandled tracked call from ${lifetime.name} failed`,
      )
  }

  beforeEach(async ({ signal, task, onTestFinished }) => {
    if (previous?.signal.aborted) unfinished ??= previous.name
    previous = { signal, name: `"${task.name}"` }
    const between = current
    const lifetime = fresh(`"${task.name}"`)
    current = lifetime
    onTestFinished(async () => {
      try {
        await close(lifetime)
      } finally {
        current = fresh(`after "${task.name}"`)
      }
    })
    if (unfinished)
      throw new Error(`Not run: ${unfinished} timed out or left calls pending and may still run`)
    await close(between)
  })

  return {
    track: <Host extends object>(host: Host): Host =>
      new Proxy(host, {
        get: (target, key, receiver) => {
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function' ? tracked(value, target) : value
        },
      }),
    gate: () => {
      const gate = Promise.withResolvers<void>()
      current.gates.push(gate.resolve)
      return gate
    },
    mount: (
      path: string,
      { fetch, ...options }: Partial<AdminOptions> & { readonly fetch: typeof globalThis.fetch },
    ) => {
      const { apps, pending } = current
      history.replaceState(null, '', path)
      document.body.innerHTML = '<div id="app"></div>'
      const app = createAdmin({
        brand,
        modules: adminModules,
        buildId: 'build-1',
        ...options,
        fetch: (input, init) => {
          const response = fetch(input, init)
          if (!(response instanceof Watched)) pending.push(response)
          return response
        },
      })
      app.mount('#app')
      apps.push(app)
      return () => document.body.textContent ?? ''
    },
  }
}
