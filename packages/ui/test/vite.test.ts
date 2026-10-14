// @vitest-environment node
import { resolveConfig, type Rolldown } from 'vite'
import { expect, test } from 'vitest'
import { opulonUi } from '../src/vite.ts'

const output = async (consumer?: Rolldown.OutputOptions) =>
  (
    await resolveConfig(
      {
        configFile: false,
        logLevel: 'silent',
        plugins: opulonUi(),
        ...(consumer ? { build: { rolldownOptions: { output: consumer } } } : {}),
      },
      'build',
    )
  ).build.rolldownOptions.output as Rolldown.OutputOptions

test('without a consumer chunking policy, ProseMirror gets its own chunk', async () => {
  expect((await output())?.codeSplitting).toEqual({
    groups: [{ name: 'prosemirror', test: expect.any(RegExp) }],
  })
})

test.each([
  ['codeSplitting: false', { codeSplitting: false }],
  [
    'codeSplitting groups',
    { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
  ],
])('a consumer %s wins over the preset', async (_, consumer: Rolldown.OutputOptions) => {
  expect((await output(consumer)).codeSplitting).toEqual(consumer.codeSplitting)
})

test('a consumer manualChunks stays in effect: the preset adds no codeSplitting', async () => {
  const manualChunks = (id: string) => (id.includes('prosemirror-') ? 'editor' : undefined)
  const resolved = await output({ manualChunks })
  expect(resolved.manualChunks).toBe(manualChunks)
  expect(resolved.codeSplitting).toBeUndefined()
})
