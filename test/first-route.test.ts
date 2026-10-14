import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { firstRoute } from '../scripts/first-route.ts'

const dist = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'first-route-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'assets'))
  for (const [file, source] of Object.entries(files)) writeFileSync(join(root, file), source)
  return root
}

test('the first route counts imported modules, index.html links and modulepreloads added at runtime', async () => {
  const root = dist({
    'index.html':
      '<link rel="stylesheet" href="/admin/assets/app.css"><script type="module" src="/admin/assets/main.js"></script>',
    'assets/app.css': '',
    'assets/main.js': `import './shared.js'
const link = document.createElement('link')
link.rel = 'modulepreload'
link.href = '/admin/assets/editor.js'
document.head.append(link)
document.querySelector('#app').innerHTML = '<section aria-label="Dashboard"></section>'`,
    'assets/shared.js': 'export {}',
    'assets/editor.js': 'export {}',
    'assets/unused.js': 'export {}',
  })
  expect(await firstRoute(root, {})).toEqual([
    'assets/app.css',
    'assets/editor.js',
    'assets/main.js',
    'assets/shared.js',
  ])
}, 30_000)
