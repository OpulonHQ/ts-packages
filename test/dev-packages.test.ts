import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import { expect, onTestFinished, test } from 'vitest'
import { packagesLoadedTwice } from '../scripts/dev-packages.ts'

async function devServer(name: string, lazyImport: string) {
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
  write(
    'main.ts',
    `import { state } from '${name}'; console.log(state); export const lazy = () => ${lazyImport.replace('PACKAGE', name)}`,
  )
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { include: [name], exclude: [`${name}/sub`] },
    server: { middlewareMode: true },
  })
  onTestFinished(() => vite.close())
  await vite.pluginContainer.buildStart({})
  return vite
}

test.each([
  ['dual', "import('PACKAGE/sub')"],
  ['@probe/dual', "import('PACKAGE/sub')"],
  ['@probe/dual', 'import(/* webpackChunkName: "lazy" */ \'PACKAGE/sub\')'],
])('finds %s loaded both prebundled and raw through %s', async (name, lazyImport) => {
  const vite = await devServer(name, lazyImport)
  expect((await packagesLoadedTwice(vite, '/main.ts')).twice).toEqual([name])
})
