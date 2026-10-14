import { type Brand, opulonUi } from '@opulonjs/ui/vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginOption } from 'vite'
import { adminOverrides } from './vite-overrides.ts'

export { editorChunkGroup } from '@opulonjs/ui/vite'

export interface OpulonAdminOptions {
  /** The host's brand; pass the same object to `createAdmin({ brand })`. */
  readonly brand?: Brand
  /** The API prefix the server composes with; import the host's one constant. Default `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Default: `OPULON_BUILD_ID` (set once in CI, passed to the Worker too), else `HEAD`'s SHA. */
  readonly buildId?: string
  /**
   * More directories with admin screens outside the Vite root, scanned for Tailwind classes and
   * Lucide icons. The shell, the UI kit and every `@opulonjs/*` dependency with admin screens
   * (an `./admin` export) add themselves.
   */
  readonly sources?: ReadonlyArray<string>
  /**
   * Kit components by canonical name (e.g. `EmptyState` or `Field/Text`) to host file paths. Any
   * `overrides`, even `{}` for screen copies only, turns on the copied files' source-header checks.
   */
  readonly overrides?: { readonly components?: Readonly<Record<string, string>> }
}

const headSha = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'dev' // not a checkout (e.g. a tarball build); the reload check then never fires
  }
}

/** The nearest directory at or above `dir` with a package.json, if any. */
const packageDir = (dir: string): string | undefined => {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, 'package.json'))) return at
    if (dirname(at) === at) return undefined
  }
}

const hostPackages = (root: string) => {
  const hostDir = packageDir(root)
  if (!hostDir) return undefined
  const manifest = join(hostDir, 'package.json')
  const host = JSON.parse(readFileSync(manifest, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const names = Object.keys({ ...host.dependencies, ...host.devDependencies })
  return { manifest, names: names.filter((name) => name.startsWith('@opulonjs/')) }
}

const moduleSources = (root: string): Array<string> => {
  const host = hostPackages(root)
  if (!host) return []
  const require = createRequire(host.manifest)
  return host.names.flatMap((name) => {
    let entry: string
    try {
      entry = require.resolve(`${name}/admin`)
    } catch {
      return []
    }
    const dir = packageDir(dirname(entry))
    return dir ? ['dist', 'src'].map((d) => join(dir, d)).filter(existsSync) : []
  })
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
    adminOverrides(options.overrides, (root) => hostPackages(root)?.names ?? []),
    vue(),
    ...opulonUi({
      ...(options.brand ? { brand: options.brand } : {}),
      sources: (root) => [shellDir, ...moduleSources(root), ...(options.sources ?? [])],
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
