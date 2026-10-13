// Packs every package (after `pnpm build`), installs the tarballs into a scratch project
// and imports each export subpath from the packed output, so CI tests what npm would ship.
// Against the same tarballs it then bundles every `/api` entry for the browser (no server-only
// imports), bundles `@opulonjs/cms/site` for the browser (no Effect) and compares the fixture
// host's server and admin module id lists.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

// Server-only code a browser bundle of `/api` entries must never reach.
const serverOnly = [
  /^node:/,
  new RegExp(`^(${builtinModules.join('|')})(/|$)`),
  /^(pg|pg-[a-z-]+|@effect\/sql-pg|@effect\/platform-node)(\/|$)/,
  /^effect\/sql(\/|$)/,
  /^@opulonjs\/core$/,
  /^@opulonjs\/[a-z]+\/(server|workers|vite)$/,
]

/**
 * Bundles every package `./api` export and every fixture host module's `api.ts` for the browser
 * (as an admin build would) and fails on the first import of server-only code.
 */
async function checkBrowserApi(scratch: string, packages: Record<string, string>) {
  const entries = [
    ...Object.keys(packages).flatMap((name) => {
      const pkg = JSON.parse(
        readFileSync(join(scratch, 'node_modules', name, 'package.json'), 'utf8'),
      ) as { exports: Record<string, unknown> }
      return Object.keys(pkg.exports)
        .filter((key) => key === './api' || key.endsWith('/api'))
        .map((key) => name + key.slice(1))
    }),
    ...readdirSync(join(scratch, 'host/modules'))
      .map((m) => `./host/modules/${m}/api.ts`)
      .filter((file) => existsSync(join(scratch, file))),
  ]
  // Stops the transform's tsconfig lookup at the scratch dir (a stray /tmp/tsconfig.json breaks it).
  // It must include .vue files too, or the lookup for them continues upwards.
  writeFileSync(join(scratch, 'tsconfig.json'), '{ "include": ["**/*.ts", "**/*.vue"] }')
  writeFileSync(
    join(scratch, 'browser-api.ts'),
    entries.map((e, i) => `import * as e${i} from '${e}'\nconsole.log(e${i})\n`).join(''),
  )
  await build({
    root: scratch,
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      lib: { entry: join(scratch, 'browser-api.ts'), formats: ['es'], fileName: 'api' },
    },
    plugins: [
      {
        name: 'no-server-imports',
        enforce: 'pre',
        resolveId(source, importer) {
          if (serverOnly.some((pattern) => pattern.test(source))) {
            this.error(`browser /api build imports server-only "${source}" (from ${importer})`)
          }
        },
      },
    ],
  })
  console.log('ok browser /api build:', entries.join(', '))
}

/**
 * Bundles the public-site entries for the browser, as a host's public site would, and fails on
 * any import of Effect: the public bundle reads the Read API with a plain fetch (ADR 0004).
 */
async function checkPublicSite(scratch: string) {
  const entries = ['@opulonjs/cms/site', '@opulonjs/cms/site/nuxt']
  writeFileSync(
    join(scratch, 'browser-site.ts'),
    entries.map((e, i) => `import * as e${i} from '${e}'\nconsole.log(e${i})\n`).join(''),
  )
  await build({
    root: scratch,
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      lib: { entry: join(scratch, 'browser-site.ts'), formats: ['es'], fileName: 'site' },
    },
    plugins: [
      {
        name: 'no-effect-imports',
        enforce: 'pre',
        resolveId(source, importer) {
          if (/^(effect|@effect\/[a-z-]+)(\/|$)/.test(source) || source.includes('HttpApiClient')) {
            this.error(`public site bundle imports "${source}" (from ${importer})`)
          }
          if (serverOnly.some((pattern) => pattern.test(source))) {
            this.error(`public site bundle imports server-only "${source}" (from ${importer})`)
          }
        },
      },
    ],
  })
  console.log('ok browser public site build without effect:', entries.join(', '))
}

// The fixture admin, built from the tarballs with the opulonAdmin() preset as a host builds it
// (Nuxt UI, brand, icons, kit components). Then, loading the admin module list through Vite (it
// imports .vue files): every admin module must have a server module of the same id;
// server-only modules are fine.
const adminCheck = `
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build, createServer } from 'vite'
import { opulonAdmin } from '@opulonjs/admin/vite'
import { packagesLoadedTwice } from '${pathToFileURL(join(import.meta.dirname, 'dev-packages.ts')).href}'
const { brand } = await import('./host/admin/brand.ts')
const { components } = await import('./host/admin/override-components.ts')
const checkOverrides = {
  name: 'check-packed-ui-override',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((output) => output.type === 'chunk')
    const modules = chunks.flatMap((chunk) => chunk.moduleIds)
    if (modules.some((id) => id.split('?')[0].endsWith('/ui/dist/components/EmptyState.mjs'))) {
      throw new Error('kit internal import bypassed the host EmptyState override')
    }
    const lazyChunk = (match, message) => {
      const chunk = chunks.find((chunk) => chunk.moduleIds.some(match))
      if (!chunk || chunk.isEntry || !chunk.isDynamicEntry) throw new Error(message)
      return chunk
    }
    const dashboard = lazyChunk((id) => id.endsWith('/admin/overrides/Dashboard.vue'), 'host Dashboard override is not a separate lazy chunk')
    const originalDashboard = lazyChunk((id) => id.includes('/admin/dist/') && id.split('/').pop().startsWith('Dashboard-'), 'original Dashboard is not in an unused lazy chunk')
    console.log('ok dashboard chunks: host', dashboard.fileName, 'original', originalDashboard.fileName)
  },
}
const config = { root: 'host/admin', configFile: false, logLevel: 'warn', plugins: [...opulonAdmin({ brand, overrides: { components } }), checkOverrides] }
await build({ ...config, build: { outDir: '../../admin-dist', emptyOutDir: true } })
console.log('ok admin build from the packed tarballs')
// Every icon a screen names is in the offline bundle (as an icon or an alias): package screens
// are found without sources.
const js = readdirSync('admin-dist/assets').filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync('admin-dist/assets/' + f, 'utf8')).join('\\n')
if (!js.includes('Fixture dashboard override')) throw new Error('packed admin screen override missing')
if (!js.includes('Fixture UI override')) throw new Error('packed admin UI override missing')
console.log('ok packed UI override for direct and kit internal imports')
const used = new Set([...js.matchAll(/i-lucide-([a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1]))
const bundled = new Set([...js.matchAll(/[{,](?:"([a-z0-9-]+)"|([a-z0-9]+)):\\{(?:body:[\`'"]<|parent:)/g)].map((m) => m[1] ?? m[2]))
const missingIcons = [...used].filter((name) => !bundled.has(name))
if (missingIcons.length > 0) throw new Error('icons missing from the admin bundle: ' + missingIcons.join(', '))
console.log('ok admin bundles all', used.size, 'icons its screens use')
const vite = await createServer({
  ...config,
  server: { port: 0, host: '127.0.0.1' },
  // Every @opulonjs package: module admin entries import the shell and kit (virtual modules).
  ssr: { noExternal: [/^@opulonjs\\//, '@nuxt/ui'] },
})
await vite.listen()
let adminModules
try {
  const transformed = await vite.transformRequest('/modules.ts')
  if (!transformed || transformed.code.split('\\n').some((line) => line.includes('.vite/deps/') && line.includes('opulonjs'))) throw new Error('published admin module was prebundled in dev')
  const require = createRequire(resolve('package.json'))
  const table = await vite.transformRequest('/@fs/' + require.resolve('@opulonjs/ui/components/DataTable'))
  if (!table?.code.includes('/overrides/EmptyState.vue')) throw new Error('published DataTable bypassed the host override in dev')
  ;({ adminModules } = await vite.ssrLoadModule('/modules.ts'))
  console.log('ok published admin dev imports use host kit overrides without prebundling')
  const { raw, bundled, twice } = await packagesLoadedTwice(vite, '/main.ts')
  if (twice.length > 0) throw new Error('admin dev loads packages both prebundled and raw, as two instances: ' + twice.join(', '))
  console.log('ok admin dev loads', raw.size, 'packages raw and', bundled.size, 'prebundled, none in both')
  const screen = spawn(process.execPath, [${JSON.stringify(join(import.meta.dirname, 'dev-screen.ts'))}, 'http://127.0.0.1:' + vite.httpServer.address().port + vite.config.base, vite.config.base + '@fs' + require.resolve('@opulonjs/admin')], { stdio: 'inherit' })
  if ((await new Promise((done) => screen.on('exit', done))) !== 0) throw new Error('the cms Collections screen failed to load its items in dev')
  console.log('ok admin dev renders the cms Collections screen with its decoded API response')
} finally { await vite.close() }
const { server } = await import('./host/server/opulon.ts')
const serverIds = new Set(server.modules.map((m) => m.id))
const missing = adminModules.map((m) => m.id).filter((id) => !serverIds.has(id))
if (missing.length > 0) throw new Error('admin modules without a server module: ' + missing.join(', '))
`

const root = resolve(import.meta.dirname, '..')

const hostDependencies = () => {
  const pkg = JSON.parse(readFileSync(join(root, 'fixtures/host/package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  return Object.fromEntries(
    Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
      ([, spec]) => !spec.startsWith('workspace:'),
    ),
  )
}
// The repo's install-script decisions, so the scratch install does not stop on them.
const allowBuilds =
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').match(/^allowBuilds:[\s\S]*/m)?.[0] ?? ''
// Browser packages need a Vite build (Nuxt UI, .vue components); the admin check covers them.
const browserOnly = ['@opulonjs/ui', '@opulonjs/admin']
const packed = join(root, '.packed')
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })

const names = readdirSync(join(root, 'packages'))
for (const dir of names) {
  if (!existsSync(join(root, 'packages', dir, 'dist'))) {
    throw new Error(`packages/${dir}/dist is missing; run \`pnpm build\` first.`)
  }
}

rmSync(packed, { recursive: true, force: true })
mkdirSync(packed)
run('pnpm', ['-r', '--filter', './packages/*', 'pack', '--pack-destination', packed], root)

const tarballs = Object.fromEntries(
  readdirSync(packed).map((file) => {
    const dir = file.replace(/^opulonjs-/, '').replace(/-\d+\.\d+\.\d+.*\.tgz$/, '')
    return [`@opulonjs/${dir}`, `file:${join(packed, file)}`]
  }),
)
if (Object.keys(tarballs).length !== names.length) {
  throw new Error(`Expected ${names.length} tarballs, got ${Object.keys(tarballs).join(', ')}`)
}

const scratch = mkdtempSync(join(tmpdir(), 'tspack-pack-'))
try {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      // The fixture host's own third-party dependencies (effect, vite, ...) plus the tarballs.
      dependencies: { ...hostDependencies(), ...tarballs },
    }),
  )
  // Internal dependencies resolve to the tarballs too, not to the registry.
  writeFileSync(
    join(scratch, 'pnpm-workspace.yaml'),
    `overrides:\n${Object.entries(tarballs)
      .map(([name, spec]) => `  '${name}': '${spec}'`)
      .join('\n')}\n${allowBuilds}`,
  )
  run('pnpm', ['install'], scratch)
  writeFileSync(
    join(scratch, 'check.mjs'),
    `import { readFileSync } from 'node:fs'
const names = ${JSON.stringify(Object.keys(tarballs))}
const browserOnly = ${JSON.stringify(browserOnly)}
for (const name of names) {
  const pkg = JSON.parse(readFileSync(new URL(\`./node_modules/\${name}/package.json\`, import.meta.url)))
  if (JSON.stringify(pkg).includes('workspace:')) throw new Error(\`\${name}: workspace: protocol leaked\`)
  for (const key of Object.keys(pkg.exports)) {
    if (key.endsWith('.json') || key.includes('*')) continue
    if (browserOnly.includes(name) && key !== './vite') continue
    // Module admin entries are browser code too; the admin module-list check loads them via Vite.
    if (key === './admin') continue
    const specifier = name + key.slice(1)
    await import(specifier)
    console.log('ok', specifier)
  }
}
`,
  )
  run('node', ['check.mjs'], scratch)

  // The fixture host's module files, resolving @opulonjs/* to the tarballs from here on.
  for (const dir of ['server', 'modules', 'admin', 'cms']) {
    cpSync(join(root, 'fixtures/host', dir), join(scratch, 'host', dir), { recursive: true })
  }
  await checkBrowserApi(scratch, tarballs)
  await checkPublicSite(scratch)
  run('node', ['--input-type=module', '-e', adminCheck], scratch)
  console.log('ok server and admin module id lists match')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
