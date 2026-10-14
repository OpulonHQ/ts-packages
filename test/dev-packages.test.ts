import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer, type Plugin } from 'vite'
import { expect, onTestFinished, test } from 'vitest'
import { packagesLoadedTwice } from '../scripts/dev-packages.ts'

async function devServer(
  name: string,
  main: string,
  files: Record<string, string> = {},
  plugins: Array<Plugin> = [],
) {
  const root = mkdtempSync(join(tmpdir(), 'dev-packages-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  write('tsconfig.json', '{}')
  const exports = { '.': './index.js', './sub': './sub.js' }
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, type: 'module', exports }))
  write(`node_modules/${name}/common.js`, 'export const state = {}')
  write(`node_modules/${name}/index.js`, 'export { state } from "./common.js"')
  write(`node_modules/${name}/sub.js`, 'export { state } from "./common.js"')
  write('main.ts', `import { state } from '${name}'; console.log(state); ${main}`)
  for (const [path, source] of Object.entries(files)) write(path, source)
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { include: [name], exclude: [`${name}/sub`] },
    server: { middlewareMode: true },
    plugins,
  })
  onTestFinished(() => vite.close())
  await vite.pluginContainer.buildStart({})
  return vite
}

test.each([
  ['dual', "import('dual/sub')"],
  ['@probe/dual', "import('@probe/dual/sub')"],
  ['@probe/dual', 'import(/* webpackChunkName: "lazy" */ \'@probe/dual/sub\')'],
])('finds %s loaded both prebundled and raw through %s', async (name, lazyImport) => {
  const vite = await devServer(name, `export const lazy = () => ${lazyImport}`)
  expect((await packagesLoadedTwice(vite, '/main.ts')).twice).toEqual([name])
})

test('follows a runtime import a plugin adds to a stylesheet module', async () => {
  const vite = await devServer(
    '@probe/dual',
    "import './style.css?url'",
    { 'style.css': ':root { color: black }' },
    [
      {
        name: 'css-runtime-import',
        enforce: 'post',
        transform: (code, id) =>
          id.endsWith('/style.css?url')
            ? `${code}\nimport { state } from '@probe/dual/sub'; globalThis.cssState = state`
            : undefined,
      },
    ],
  )
  expect((await packagesLoadedTwice(vite, '/main.ts')).twice).toEqual(['@probe/dual'])
})

test('does not count a prebundled package stylesheet as a second instance', async () => {
  const vite = await devServer('dual', "import 'dual/style.css'", {
    'node_modules/dual/package.json': JSON.stringify({
      name: 'dual',
      type: 'module',
      exports: { '.': './index.js', './sub': './sub.js', './style.css': './style.css' },
    }),
    'node_modules/dual/style.css': ':root { color: black }',
  })
  expect((await packagesLoadedTwice(vite, '/main.ts')).twice).toEqual([])
})

test.each([
  ["import icon from 'dual/icon.svg'; console.log(icon)"],
  ["import text from 'dual/sub.js?raw'; console.log(text)"],
  ["import url from 'dual/sub.js?url'; console.log(url)"],
])('does not count a prebundled package asset as a second instance: %s', async (main) => {
  const vite = await devServer('dual', main, {
    'node_modules/dual/package.json': JSON.stringify({
      name: 'dual',
      type: 'module',
      exports: { '.': './index.js', './sub.js': './sub.js', './icon.svg': './icon.svg' },
    }),
    'node_modules/dual/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  })
  expect((await packagesLoadedTwice(vite, '/main.ts')).twice).toEqual([])
})
