// Packs every package (after `pnpm build`), installs the tarballs into a scratch project
// and imports each export subpath from the packed output, so CI tests what npm would ship.
// Against the same tarballs it then bundles every `/api` entry for the browser (no server-only
// imports) and compares the fixture host's server and admin module id lists.
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
  writeFileSync(join(scratch, 'tsconfig.json'), '{}')
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

// Every admin module must have a server module of the same id; server-only modules are fine.
const moduleIdCheck = `
const { server } = await import('./host/server/opulon.ts')
const { adminModules } = await import('./host/admin/modules.ts')
const serverIds = new Set(server.modules.map((m) => m.id))
const missing = adminModules.map((m) => m.id).filter((id) => !serverIds.has(id))
if (missing.length > 0) throw new Error('admin modules without a server module: ' + missing.join(', '))
`

const root = resolve(import.meta.dirname, '..')

const hostDependencies = () => {
  const pkg = JSON.parse(readFileSync(join(root, 'fixtures/host/package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  return Object.fromEntries(
    Object.entries(pkg.dependencies).filter(([, spec]) => !spec.startsWith('workspace:')),
  )
}
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
      // The fixture host's own third-party dependencies (effect, ...) plus the tarballs.
      dependencies: { ...hostDependencies(), ...tarballs },
    }),
  )
  // Internal dependencies resolve to the tarballs too, not to the registry.
  writeFileSync(
    join(scratch, 'pnpm-workspace.yaml'),
    `overrides:\n${Object.entries(tarballs)
      .map(([name, spec]) => `  '${name}': '${spec}'`)
      .join('\n')}\n`,
  )
  run('pnpm', ['install'], scratch)
  writeFileSync(
    join(scratch, 'check.mjs'),
    `import { readFileSync } from 'node:fs'
const names = ${JSON.stringify(Object.keys(tarballs))}
for (const name of names) {
  const pkg = JSON.parse(readFileSync(new URL(\`./node_modules/\${name}/package.json\`, import.meta.url)))
  if (JSON.stringify(pkg).includes('workspace:')) throw new Error(\`\${name}: workspace: protocol leaked\`)
  for (const key of Object.keys(pkg.exports)) {
    if (key.endsWith('.json')) continue
    const specifier = name + key.slice(1)
    await import(specifier)
    console.log('ok', specifier)
  }
}
`,
  )
  run('node', ['check.mjs'], scratch)

  // The fixture host's module files, resolving @opulonjs/* to the tarballs from here on.
  for (const dir of ['server', 'modules', 'admin']) {
    cpSync(join(root, 'fixtures/host', dir), join(scratch, 'host', dir), { recursive: true })
  }
  await checkBrowserApi(scratch, tarballs)
  run('node', ['--input-type=module', '-e', moduleIdCheck], scratch)
  console.log('ok server and admin module id lists match')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
