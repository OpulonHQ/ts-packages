// Packs every package (after `pnpm build`), installs the tarballs into a scratch project
// and imports each export subpath from the packed output, so CI tests what npm would ship.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
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
    JSON.stringify({ private: true, type: 'module', dependencies: tarballs }),
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
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
