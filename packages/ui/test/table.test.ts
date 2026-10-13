import { expect, test } from 'vitest'
import { nextSort, queryRows, type TableQuery } from '../src/table.ts'

const rows = [
  { id: 1, title: 'Banana', author: { name: 'Eva' }, status: 'draft' },
  { id: 2, title: 'apple', author: { name: 'Adam' }, status: 'published' },
  { id: 3, title: 'Cherry 10', author: { name: 'Eva' }, status: 'published' },
  { id: 4, title: 'Cherry 9', author: null, status: 'published' },
]
const query = (q: Partial<TableQuery>): TableQuery => ({
  page: 1,
  perPage: 25,
  sort: null,
  search: '',
  filters: {},
  ...q,
})
const ids = (q: Partial<TableQuery>) =>
  queryRows(rows, ['title', 'author.name'], query(q)).rows.map((r) => r.id)

test('client mode searches any column (dotted paths too), case-insensitive', () => {
  expect(ids({ search: 'eva' })).toEqual([1, 3])
  expect(ids({ search: 'APPLE' })).toEqual([2])
})

test('client mode filters by exact value', () => {
  expect(ids({ filters: { status: 'published' } })).toEqual([2, 3, 4])
})

test('client mode sorts naturally, empty values last, and pages', () => {
  expect(ids({ sort: { column: 'title', direction: 'asc' } })).toEqual([2, 1, 4, 3])
  expect(ids({ sort: { column: 'author.name', direction: 'desc' } })).toEqual([1, 3, 2, 4])
  expect(queryRows(rows, ['title'], query({ page: 2, perPage: 3 }))).toEqual({
    rows: [rows[3]],
    total: 4,
  })
})

test('header clicks cycle none, asc, desc, none', () => {
  const asc = nextSort(null, 'title')
  expect(asc).toEqual({ column: 'title', direction: 'asc' })
  expect(nextSort(asc, 'title')).toEqual({ column: 'title', direction: 'desc' })
  expect(nextSort({ column: 'title', direction: 'desc' }, 'title')).toBeNull()
  expect(nextSort(asc, 'author')).toEqual({ column: 'author', direction: 'asc' })
})
