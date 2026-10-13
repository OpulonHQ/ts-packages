import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const eslint = new ESLint()

async function lintImport(file: string, specifier: string) {
  const [result] = await eslint.lintText(`import '${specifier}'\n`, { filePath: file })
  return result!.messages.map((m) => m.ruleId)
}

// TSPACK-6 / ADR 0001: server users->emails, cms->media, all->core; browser ui<-admin<-module admin entries.
describe('package graph', () => {
  test.each([
    ['packages/users/src/x.ts', '@opulonjs/emails'],
    ['packages/users/src/x.ts', '@opulonjs/core/workers'],
    ['packages/cms/src/x.ts', '@opulonjs/media'],
    ['packages/media/src/x.ts', '@opulonjs/core'],
    ['packages/admin/src/x.ts', '@opulonjs/ui'],
    ['packages/admin/src/x.ts', '@opulonjs/core/api'],
    ['packages/cms/src/admin/x.ts', '@opulonjs/admin'],
    ['packages/ui/src/x.ts', '@nuxt/ui'],
    ['packages/ui/src/x.ts', '@nuxt/ui/components/Button.vue'],
  ])('%s may import %s', async (file, specifier) => {
    expect(await lintImport(file, specifier)).toEqual([])
  })

  test.each([
    ['packages/core/src/x.ts', '@opulonjs/users'],
    ['packages/emails/src/x.ts', '@opulonjs/users'],
    ['packages/media/src/x.ts', '@opulonjs/cms'],
    ['packages/users/src/x.ts', '@opulonjs/cms/server'],
    ['packages/cms/src/x.ts', '@opulonjs/emails'],
    ['packages/ui/src/x.ts', '@opulonjs/admin'],
    ['packages/admin/src/x.ts', '@opulonjs/users'],
    ['packages/admin/src/x.ts', '@opulonjs/core'],
    ['packages/admin/src/x.ts', '@opulonjs/core/workers'],
    ['packages/admin/src/x.ts', '@nuxt/ui'],
    ['packages/cms/src/admin/x.ts', '@nuxt/ui/components/Button.vue'],
    ['fixtures/host/x.ts', '@nuxt/ui'],
  ])('%s may not import %s', async (file, specifier) => {
    expect(await lintImport(file, specifier)).toEqual(['no-restricted-imports'])
  })
})
