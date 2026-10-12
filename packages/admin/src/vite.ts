import { type Brand, opulonUi } from '@opulonjs/ui/vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginOption } from 'vite'

export interface OpulonAdminOptions {
  /** The host's brand; pass the same object to `createAdmin({ brand })`. */
  readonly brand?: Brand
  /** The API prefix the server composes with; import the host's one constant. Default `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Default: `OPULON_BUILD_ID` (set once in CI, passed to the Worker too), else `HEAD`'s SHA. */
  readonly buildId?: string
  /**
   * Package directories with admin screens outside the Vite root (installed module packages):
   * scanned for Tailwind classes and Lucide icons. The shell and the UI kit add themselves.
   */
  readonly sources?: ReadonlyArray<string>
}

const headSha = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'dev' // not a checkout (e.g. a tarball build); the reload check then never fires
  }
}

/**
 * Vite preset for a host's `admin/` build: Vue SFCs, Nuxt UI branded at build time (palettes,
 * radius, font, component overrides), self-hosted Inter, offline Lucide icons, base `/admin/`,
 * and the build id and API prefix injected into `index.html` as `<meta>` tags for `createAdmin`.
 */
export const opulonAdmin = (options: OpulonAdminOptions = {}): Array<PluginOption> => {
  const buildId = options.buildId ?? process.env.OPULON_BUILD_ID ?? headSha()
  const apiPrefix = options.apiPrefix ?? '/api'
  const shellDir = dirname(fileURLToPath(import.meta.url))
  return [
    vue(),
    ...opulonUi({
      ...(options.brand ? { brand: options.brand } : {}),
      sources: [shellDir, ...(options.sources ?? [])],
    }),
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
