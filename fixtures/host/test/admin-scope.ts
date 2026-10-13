import { type AdminOptions, createAdmin } from '@opulonjs/admin'
import { afterEach, beforeEach } from 'vitest'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'

/**
 * Admin journeys for one test file. After each test the mounted admins unmount, the test's gates
 * open and every request the admins or a `track`ed host started settles (failing after 5s). Vitest does not cancel a
 * timed-out test body or hook, so once a test or its hooks time out, or its requests do not
 * settle, no later test in the file runs: a late body cannot reach another test's DOM or data.
 */
export const useAdminLifetime = () => {
  type Lifetime = {
    readonly apps: Array<{ unmount: () => void }>
    readonly gates: Array<() => void>
    readonly pending: Set<Promise<unknown>>
  }
  let current: Lifetime = { apps: [], gates: [], pending: new Set() }
  let unfinished: string | undefined
  let previous: { readonly signal: AbortSignal; readonly name: string } | undefined
  const settle = (pending: Set<Promise<unknown>>, work: Promise<unknown>) => {
    pending.add(work)
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    )
  }
  const tracked =
    (fn: Parameters<typeof Reflect.apply>[0], self: unknown) =>
    (...args: unknown[]): unknown => {
      const result: unknown = Reflect.apply(fn, self, args)
      if (result instanceof Promise) settle(current.pending, result)
      return typeof result === 'function' ? tracked(result, undefined) : result
    }

  beforeEach(({ signal, task }) => {
    if (previous?.signal.aborted) unfinished ??= previous.name
    previous = { signal, name: task.name }
    current = { apps: [], gates: [], pending: new Set() }
    if (unfinished)
      throw new Error(
        `Not run: "${unfinished}" timed out or left requests pending and may still run`,
      )
  })

  afterEach(async ({ task }) => {
    const { apps, gates, pending } = current
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
    if (pending.size > 0) {
      unfinished ??= task.name
      throw new Error(`${pending.size} request(s) still pending 5s after the test finished`)
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
          settle(pending, response)
          return response
        },
      })
      app.mount('#app')
      apps.push(app)
      return () => document.body.textContent ?? ''
    },
  }
}
