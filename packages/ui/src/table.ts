import type { SelectItem } from './fields.ts'
import { getPath } from './format.ts'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  readonly column: string
  readonly direction: SortDirection
}

/** What a server-mode `DataTable` asks its `load` function for. */
export interface TableQuery {
  /** 1-based. */
  readonly page: number
  readonly perPage: number
  readonly sort: SortState | null
  /** Trimmed; empty means no search. */
  readonly search: string
  /** Select filter values by filter key; unset filters are absent. */
  readonly filters: Readonly<Record<string, string | number>>
}

export interface TablePage<Row> {
  readonly rows: ReadonlyArray<Row>
  readonly total: number
}

/** Header click cycle: none -> asc -> desc -> none. */
export const nextSort = (current: SortState | null, column: string): SortState | null =>
  current?.column !== column
    ? { column, direction: 'asc' }
    : current.direction === 'asc'
      ? { column, direction: 'desc' }
      : null

/**
 * Client mode: search (any column's text contains the term, case-insensitive), exact-match
 * filters, sort and one page, in memory.
 */
export const queryRows = <Row>(
  rows: ReadonlyArray<Row>,
  columns: ReadonlyArray<string>,
  query: TableQuery,
): TablePage<Row> => {
  const term = query.search.toLowerCase()
  let result = rows.filter(
    (row) =>
      (term === '' ||
        columns.some((key) =>
          String(getPath(row, key) ?? '')
            .toLowerCase()
            .includes(term),
        )) &&
      Object.entries(query.filters).every(([key, value]) => getPath(row, key) === value),
  )
  const sort = query.sort
  if (sort) {
    const sign = sort.direction === 'asc' ? 1 : -1
    result = [...result].sort((a, b) => {
      const x = getPath(a, sort.column)
      const y = getPath(b, sort.column)
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign
      )
    })
  }
  const start = (query.page - 1) * query.perPage
  return { rows: result.slice(start, start + query.perPage), total: result.length }
}

export interface DataTableColumn<R> {
  /** Row key; dotted paths work (`author.name`). Also the sort key. */
  key: string
  /** Header label; defaults to the humanized key. */
  label?: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  /** Plain-text cell; for rich cells use the `#<key>-cell` slot. */
  format?: (value: unknown, row: R) => string
}

export interface DataTableFilter {
  key: string
  label: string
  options: ReadonlyArray<SelectItem>
}
