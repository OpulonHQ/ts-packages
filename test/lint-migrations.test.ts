import { expect, test } from 'vitest'
import { lintMigrations } from '../scripts/lint-migrations.ts'

const dir = 'packages/cms/migrations'
const base = [`${dir}/0001_create_page.ts`, `${dir}/0002_add_seo.ts`, 'packages/cms/src/index.ts']

test('accepts new migrations with higher ids and unrelated edits', () => {
  expect(
    lintMigrations(base, [
      { status: 'A', path: `${dir}/0004_skip_is_fine.ts` },
      { status: 'A', path: `${dir}/0003_add_slug.ts` },
      { status: 'A', path: 'packages/media/migrations/0001_create_file.ts' },
      { status: 'M', path: 'packages/cms/src/index.ts' },
    ]),
  ).toEqual([])
})

test('rejects a new id at or below an existing one', () => {
  expect(lintMigrations(base, [{ status: 'A', path: `${dir}/0002_other.ts` }])).toEqual([
    `${dir}/0002_other.ts: id 2 must be greater than 2`,
  ])
})

test('rejects two new migrations with the same id', () => {
  expect(
    lintMigrations(base, [
      { status: 'A', path: `${dir}/0003_a.ts` },
      { status: 'A', path: `${dir}/0003_b.ts` },
    ]),
  ).toEqual([`${dir}/0003_b.ts: id 3 must be greater than 3`])
})

test('rejects editing or removing an existing migration', () => {
  expect(
    lintMigrations(base, [
      { status: 'M', path: `${dir}/0001_create_page.ts` },
      { status: 'D', path: `${dir}/0002_add_seo.ts` },
    ]),
  ).toEqual([
    `${dir}/0001_create_page.ts: applied migrations are append-only (status M)`,
    `${dir}/0002_add_seo.ts: applied migrations are append-only (status D)`,
  ])
})
