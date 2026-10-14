import { type AdminOptions, createAdmin } from '@opulonjs/admin'
import { beforeEach } from 'vitest'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'

type Calls = {
  readonly pending: Array<Promise<unknown>>
  readonly rejected: Array<{ readonly call: Watched<unknown>; readonly error: unknown }>
}

// `await` adopts a plain Promise without calling `then`, so only a subclass sees every consumer.
class Watched<T> extends Promise<T> {
  observed = false
  current: (() => Calls) | undefined
  watch(current: () => Calls) {
    this.current = current
    const calls = current()
    calls.pending.push(this)
    Promise.prototype.then.call(this, undefined, (error: unknown) =>
      calls.rejected.push({ call: this, error }),
    )
    return this
  }
  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.observed = true
    const next = super.then(onFulfilled, onRejected)
    if (this.current && next instanceof Watched) next.watch(this.current)
    return next
  }
}

/**
 * Admin journeys for one test file. When a test finishes, after its own cleanup callbacks, the
 * mounted admins unmount, the test's gates open and every call the admins or a `track`ed host
 * started settles, including work chained on a tracked call (failing after 5s). A tracked
 * call that rejected while nothing awaited or caught it fails the test that started it. Calls
 * started between tests (`beforeAll`, `onTestFailed`) settle before the next test starts.
 * Vitest does not cancel a timed-out test body or hook, so once a test or its hooks time out,
 * its calls do not settle or an admin fails to unmount, no later test in the file runs: a late
 * body cannot reach another test's DOM, URL or data.
 */
export const useAdminLifetime = () => {
  type Lifetime = Calls & {
    readonly name: string
    readonly unmounts: Array<() => void>
    unmountFailed: boolean
    readonly gates: Array<() => void>
  }
  const fresh = (name: string): Lifetime => ({
    name,
    unmounts: [],
    unmountFailed: false,
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
      if (result instanceof Promise)
        return new Watched((resolve, reject) => {
          result.then(resolve, reject)
        }).watch(() => current)
      return typeof result === 'function' ? tracked(result, undefined) : result
    }

  const settle = async ({ pending }: Lifetime) => {
    let settled = false
    const drained = (async () => {
      let seen = 0
      do {
        for (; seen < pending.length; seen++)
          await Promise.prototype.then.call(
            pending[seen],
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
      for (const unmount of lifetime.unmounts) {
        try {
          unmount()
        } catch (error) {
          failures.push(error)
        }
      }
      for (const release of lifetime.gates) release()
      const settled = await settle(lifetime)
      document.body.replaceChildren()
      if (!settled)
        failures.push(new Error(`admin or host calls from ${lifetime.name} still pending after 5s`))
      for (const { call, error } of lifetime.rejected) if (!call.observed) failures.push(error)
      clean = settled && !lifetime.unmountFailed
    } finally {
      if (!clean) unfinished ??= lifetime.name
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, `cleanup of ${lifetime.name} failed`)
  }

  beforeEach(async ({ signal, task, onTestFinished }) => {
    if (previous?.signal.aborted) unfinished ??= previous.name
    previous = { signal, name: `"${task.name}"` }
    const between = current
    const lifetime = fresh(`"${task.name}"`)
    onTestFinished(async () => {
      try {
        await close(lifetime)
      } finally {
        current = fresh(`after "${task.name}"`)
      }
    })
    if (unfinished)
      throw new Error(`Not run: ${unfinished} timed out or left calls pending and may still run`)
    try {
      await close(between)
    } finally {
      current = lifetime
    }
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
      const lifetime = current
      history.replaceState(null, '', path)
      document.body.innerHTML = '<div id="app"></div>'
      const app = createAdmin({
        brand,
        modules: adminModules,
        buildId: 'build-1',
        ...options,
        fetch: (input, init) => {
          const response = fetch(input, init)
          if (!(response instanceof Watched)) lifetime.pending.push(response)
          return response
        },
      })
      app.mount('#app')
      let mounted = true
      const unmount = () => {
        if (!mounted) return
        mounted = false
        const errors: Array<unknown> = []
        const { errorHandler } = app.config
        app.config.errorHandler = (error) => void errors.push(error)
        try {
          app.unmount()
        } catch (error) {
          errors.push(error)
        } finally {
          app.config.errorHandler = errorHandler
        }
        if (errors.length > 0) {
          lifetime.unmountFailed = true
          throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'unmount failed')
        }
      }
      lifetime.unmounts.push(unmount)
      return Object.assign(() => document.body.textContent ?? '', { app, unmount })
    },
  }
}
