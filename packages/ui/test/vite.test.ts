// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, resolveConfig, type Rolldown } from 'vite'
import { expect, onTestFinished, test } from 'vitest'
import { editorChunkGroup, opulonUi } from '../src/vite.ts'

test.each([
  undefined,
  { codeSplitting: false },
  { inlineDynamicImports: true },
  { manualChunks: () => 'one' },
])('the preset leaves consumer chunking untouched: %o', async (output?: Rolldown.OutputOptions) => {
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      plugins: opulonUi(),
      ...(output ? { build: { rolldownOptions: { output } } } : {}),
    },
    'build',
  )
  expect(resolved.build.rolldownOptions.output).toEqual(output)
})

test('editorChunkGroup puts ProseMirror in its own chunk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opulon-editor-chunk-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  write('tsconfig.json', '{}')
  write('main.js', "import('./editor.js').then((editor) => console.log(editor))")
  write('editor.js', "import { schema } from 'prosemirror-model'\nconsole.log(schema, 'tiptap')")
  write(
    'node_modules/prosemirror-model/package.json',
    '{ "name": "prosemirror-model", "type": "module", "main": "index.js" }',
  )
  write('node_modules/prosemirror-model/index.js', "export const schema = 'prosemirror schema'")
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      rolldownOptions: {
        input: join(root, 'main.js'),
        output: { codeSplitting: { groups: [editorChunkGroup] } },
      },
    },
  })
  const chunks = (
    Array.isArray(result) ? result[0]! : (result as Rolldown.RolldownOutput)
  ).output.filter((output) => output.type === 'chunk')
  const prosemirror = chunks.find((chunk) => chunk.name === 'prosemirror')
  expect(prosemirror?.moduleIds.map((id) => id.replace(root, ''))).toEqual([
    '/node_modules/prosemirror-model/index.js',
  ])
  expect(chunks.find((chunk) => chunk.code.includes("'tiptap'"))?.name).not.toBe('prosemirror')
})
