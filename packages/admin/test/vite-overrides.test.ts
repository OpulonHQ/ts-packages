// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, createLogger, createServer, type InlineConfig } from 'vite'
import { expect, onTestFinished, test } from 'vitest'
import { opulonAdmin, type OpulonAdminOptions } from '../src/vite.ts'

function host(version = '1.2.0') {
  const root = mkdtempSync(join(tmpdir(), 'opulon-overrides-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, source: string) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
    return file
  }
  write('package.json', JSON.stringify({ type: 'module' }))
  write('tsconfig.json', '{}')
  write(
    'node_modules/@opulonjs/ui/package.json',
    JSON.stringify({
      name: '@opulonjs/ui',
      version,
      type: 'module',
      exports: {
        './package.json': './package.json',
        './components/*': {
          '@opulonjs/source': './src/components/*.vue',
          default: './dist/components/*.mjs',
        },
      },
    }),
  )
  for (const name of ['EmptyState', 'Field/Text']) {
    write(
      `node_modules/@opulonjs/ui/src/components/${name}.vue`,
      `<template>kit ${name}</template>`,
    )
    write(`node_modules/@opulonjs/ui/dist/components/${name}.mjs`, `export default 'kit ${name}'`)
  }
  write('HostEmpty.vue', '<template>host empty</template>')
  write('HostText.vue', '<template>host text</template>')
  write(
    'entry.js',
    "import component from '@opulonjs/ui/components/EmptyState'; console.log(component)",
  )
  const config = (options: OpulonAdminOptions = {}, extra: InlineConfig = {}): InlineConfig => ({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: opulonAdmin({ buildId: 'test', ...options }),
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: join(root, 'entry.js'), external: ['vue'] },
    },
    ...extra,
  })
  const bundle = async (options: OpulonAdminOptions = {}, extra: InlineConfig = {}) => {
    const result = await build(config(options, extra))
    if (Array.isArray(result) || !('output' in result)) throw new Error('expected one build output')
    return result.output.flatMap((entry) => (entry.type === 'chunk' ? [entry.code] : [])).join('\n')
  }
  return { root, write, config, bundle }
}

test.each([{ conditions: [] }, { conditions: ['@opulonjs/source'] }])(
  'build replaces canonical and internal kit imports: %j',
  async ({ conditions }) => {
    const fixture = host()
    fixture.write(
      'node_modules/@opulonjs/ui/src/components/Table.vue',
      `<script setup>import Empty from './EmptyState.vue'; import Text from './Field/Text.vue'</script><template><Empty/><Text/></template>`,
    )
    fixture.write(
      'node_modules/@opulonjs/ui/dist/components/Table.mjs',
      "import Empty from './EmptyState.mjs'; import Text from './Field/Text.mjs'; export default [Empty, Text]",
    )
    fixture.write(
      'entry.js',
      "import Table from '@opulonjs/ui/components/Table'; import Empty from '@opulonjs/ui/components/EmptyState'; import Text from '@opulonjs/ui/components/Field/Text'; console.log(Table, Empty, Text)",
    )
    const output = await fixture.bundle(
      {
        overrides: {
          components: {
            EmptyState: 'HostEmpty.vue',
            'Field/Text': join(fixture.root, 'HostText.vue'),
          },
        },
      },
      { resolve: { conditions } },
    )
    expect(output).toContain('host empty')
    expect(output).toContain('host text')
    expect(output).not.toContain('kit EmptyState')
    expect(output).not.toContain('kit Field/Text')
  },
)

test('does not capture unrelated same-named host imports or Vue query modules', async () => {
  const fixture = host()
  const unrelated = fixture.write(
    'other/EmptyState.vue',
    '<template>unrelated host empty</template>',
  )
  fixture.write('entry.js', "import Other from './other/EmptyState.vue'; console.log(Other)")
  const options = { overrides: { components: { EmptyState: 'HostEmpty.vue' } } }
  expect(await fixture.bundle(options)).toContain('unrelated host empty')
  const server = await createServer(fixture.config(options, { server: { middlewareMode: true } }))
  onTestFinished(() => server.close())
  await server.pluginContainer.buildStart({})
  const importer = join(fixture.root, 'node_modules/@opulonjs/ui/src/components/Table.vue')
  expect(
    (await server.pluginContainer.resolveId('@opulonjs/ui/components/EmptyState', importer))?.id,
  ).toBe(join(fixture.root, 'HostEmpty.vue'))
  const publishedImporter = join(
    fixture.root,
    'node_modules/@opulonjs/ui/dist/components/Table.mjs',
  )
  expect((await server.pluginContainer.resolveId('./EmptyState.mjs', publishedImporter))?.id).toBe(
    join(fixture.root, 'HostEmpty.vue'),
  )
  const query = './EmptyState.vue?vue&type=script&lang.ts'
  expect((await server.pluginContainer.resolveId(query, importer))?.id).not.toContain(
    'HostEmpty.vue',
  )
  expect((await server.pluginContainer.resolveId('./EmptyState.vue', unrelated))?.id).not.toContain(
    'HostEmpty.vue',
  )
})

test.each([
  ['MissingComponent', 'HostEmpty.vue', /MissingComponent/],
  ['../EmptyState', 'HostEmpty.vue', /\.\.\/EmptyState/],
  ['EmptyState.vue', 'HostEmpty.vue', /EmptyState\.vue/],
  ['EmptyState', 'missing.vue', /missing\.vue/],
  ['EmptyState', '.', /directory|file/i],
  ['EmptyState', '', /EmptyState/],
])('fails clearly for invalid override %s -> %s', async (name, target, message) => {
  const fixture = host()
  await expect(fixture.bundle({ overrides: { components: { [name]: target } } })).rejects.toThrow(
    message,
  )
})

test.each([
  ['1.3.0', '1.2.9', true],
  ['2.0.0', '1.99.0', true],
  ['1.2.0', '1.2.0-beta.10', true],
  ['1.2.0-beta.10', '1.2.0-beta.2', true],
  ['1.2.0-beta.2', '1.2.0-alpha.9', true],
  ['1.2.0-beta.2', '1.2.0-beta', true],
  ['1.2.0-alpha', '1.2.0-1', true],
  ['1.2.0-1', '1.2.0-alpha', false],
  ['1.2.0-beta.2', '1.2.0', false],
  ['1.2.0', '1.2.0+host.1', false],
  ['1.2.0', '1.3.0', false],
  ['1.2.0', '1.2.0', false],
])('warns for copied screen version %s vs header %s: %s', async (installed, copied, warns) => {
  const fixture = host(installed)
  fixture.write(
    'Screen.vue',
    `<!-- @opulonjs/source @opulonjs/ui@${copied} src/components/EmptyState.vue -->\n<template>copied screen</template>`,
  )
  fixture.write('entry.js', "import Screen from './Screen.vue'; console.log(Screen)")
  const warnings: string[] = []
  const logger = createLogger('silent')
  logger.warn = (message) => {
    warnings.push(message)
  }
  expect(await fixture.bundle({}, { customLogger: logger })).toContain('copied screen')
  const provenance = warnings.filter((message) => message.includes('@opulonjs/source'))
  expect(provenance.length).toBe(warns ? 1 : 0)
  if (warns) {
    expect(provenance[0]).toContain(installed)
    expect(provenance[0]).toContain(copied)
    expect(provenance[0]).toContain('Screen.vue')
    expect(provenance[0]).toContain('src/components/EmptyState.vue')
  }
})

test.each([
  ['Screen.js', '// @opulonjs/source @opulonjs/ui@1.0.0 src/components/EmptyState.vue'],
  ['Screen.ts', '// @opulonjs/source @opulonjs/ui@1.0.0 src/components/EmptyState.vue'],
  ['Screen.ts', '/* @opulonjs/source @opulonjs/ui@1.0.0 src/components/EmptyState.vue */'],
])(
  'scans %s first-line headers, ignoring later headers and dependency source',
  async (file, header) => {
    const fixture = host()
    fixture.write(file, `${header}\nexport default "copied JS"`)
    fixture.write(
      'Later.js',
      '\n// @opulonjs/source @opulonjs/ui@1.0.0 src/components/EmptyState.vue\nexport default "later header"',
    )
    fixture.write(
      'node_modules/@opulonjs/ui/dist/components/EmptyState.mjs',
      '// @opulonjs/source @opulonjs/ui@1.0.0 src/components/EmptyState.vue\nexport default "dependency"',
    )
    fixture.write(
      'entry.js',
      `import Screen from './${file}'; import Later from './Later.js'; import Kit from '@opulonjs/ui/components/EmptyState'; console.log(Screen, Later, Kit)`,
    )
    const warnings: string[] = []
    const logger = createLogger('silent')
    logger.warn = (message) => {
      warnings.push(message)
    }
    await fixture.bundle({}, { customLogger: logger })
    const provenance = warnings.filter((message) => message.includes('@opulonjs/source'))
    expect(provenance).toHaveLength(1)
    expect(provenance[0]).toContain(file)
  },
)
