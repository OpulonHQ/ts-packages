import { type AdminOptions, createAdmin } from '@opulonjs/admin'
import { beforeEach } from 'vitest'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'

/**
 * Admin journeys for one test file. When a test finishes, after its own cleanup callbacks, the
 * mounted admins unmount, the test's gates open and every call the admins or a `track`ed host
 * started settles, including calls chained within one timer tick (failing after 5s); a tracked
 * host call that rejected, or an unmount that threw, fails the test. Vitest does not cancel a
 * timed-out test body or hook, so once a test or its hooks time out, or its calls do not settle,
 * no later test in the file runs: a late body cannot reach another test's DOM or data.
 */
export const useAdminLifetime = () => {
  type Lifetime = {
    readonly apps: Array<{ unmount: () => void }>
    readonly gates: Array<() => void>
    readonly pending: Array<Promise<unknown>>
    readonly failures: Array<unknown>
  }
  const fresh = (): Lifetime => ({ apps: [], gates: [], pending: [], failures: [] })
  let current = fresh()
  let unfinished: string | undefined
  let previous: { readonly signal: AbortSignal; readonly name: string } | undefined
  const tracked =
    (fn: Parameters<typeof Reflect.apply>[0], self: unknown) =>
    (...args: unknown[]): unknown => {
      const result: unknown = Reflect.apply(fn, self, args)
      if (result instanceof Promise) {
        const { pending, failures } = current
        pending.push(result)
        result.catch((error: unknown) => failures.push(error))
      }
      return typeof result === 'function' ? tracked(result, undefined) : result
    }

  const finish = async (name: string) => {
    const { apps, gates, pending, failures } = current
    for (const app of apps) {
      try {
        app.unmount()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const release of gates) release()
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
    document.body.replaceChildren()
    current = fresh()
    if (!settled) {
      unfinished ??= name
      throw new Error('admin or host calls still pending 5s after the test finished')
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'a tracked host call or unmount failed')
  }

  beforeEach(({ signal, task, onTestFinished }) => {
    if (previous?.signal.aborted) unfinished ??= previous.name
    previous = { signal, name: task.name }
    onTestFinished(() => finish(task.name))
    if (unfinished)
      throw new Error(`Not run: "${unfinished}" timed out or left calls pending and may still run`)
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
      {
        fetch,
        modules = adminModules,
      }: { fetch: typeof globalThis.fetch; modules?: AdminOptions['modules'] },
    ) => {
      const { apps, pending } = current
      history.replaceState(null, '', path)
      document.body.innerHTML = '<div id="app"></div>'
      const app = createAdmin({
        brand,
        modules,
        buildId: 'build-1',
        fetch: (input, init) => {
          const response = fetch(input, init)
          pending.push(response)
          return response
        },
      })
      app.mount('#app')
      apps.push(app)
      return () => document.body.textContent ?? ''
    },
  }
}
