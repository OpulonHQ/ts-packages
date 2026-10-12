import { builtinEnvironments, type Environment } from 'vitest/runtime'

// happy-dom, but with Node's fetch classes. Admin tests run the fixture Worker in the same
// process, and happy-dom's Request drops "forbidden" headers (cookie, origin) that a server
// (users' session cookie, CSRF origin checks) must see. Screens get their fetch injected, so
// they never touch these globals.
const names = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'Blob',
  'File',
  'AbortController',
  'AbortSignal',
] as const

export default {
  ...builtinEnvironments['happy-dom'],
  name: 'happy-dom-server',
  async setup(global, options) {
    const native = Object.fromEntries(names.map((n) => [n, global[n]]))
    const env = await builtinEnvironments['happy-dom'].setup(global, options)
    Object.assign(global, native)
    return env
  },
} satisfies Environment
