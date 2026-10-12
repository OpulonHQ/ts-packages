import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'
import type { Plugin } from 'vite'

export interface OpulonAdminOptions {
  /** The API prefix the server composes with; import the host's one constant. Default `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Default: `OPULON_BUILD_ID` (set once in CI, passed to the Worker too), else `HEAD`'s SHA. */
  readonly buildId?: string
}

const headSha = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'dev' // not a checkout (e.g. a tarball build); the reload check then never fires
  }
}

/**
 * Vite preset for a host's `admin/` build: Vue SFCs, base `/admin/`, and the build id and API
 * prefix injected into `index.html` as `<meta>` tags that `createAdmin` reads. Nuxt UI, Inter,
 * Lucide and component overrides join with the UI kit (TSPACK-26).
 */
export const opulonAdmin = (options: OpulonAdminOptions = {}): Array<Plugin> => {
  const buildId = options.buildId ?? process.env.OPULON_BUILD_ID ?? headSha()
  const apiPrefix = options.apiPrefix ?? '/api'
  return [
    vue(),
    {
      name: '@opulonjs/admin',
      config: () => ({ base: '/admin/' }),
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { name: 'opulon-build-id', content: buildId }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'opulon-api-prefix', content: apiPrefix }, injectTo: 'head' },
      ],
    },
  ]
}
