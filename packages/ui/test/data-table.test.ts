import { expect, test } from 'vitest'
import { createApp, defineComponent, h, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import DataTable from '../src/components/DataTable.vue'
import { type TablePage, UApp, uiPlugin } from '../src/index.ts'

type Row = { title: string; status: string }

const mount = (props: Record<string, unknown>, onTestFinished: (fn: () => void) => void) => {
  const root = defineComponent(
    () => () => h(UApp, null, { default: () => h(DataTable as unknown as Component, props) }),
  )
  document.body.innerHTML = '<div id="table"></div>'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: defineComponent(() => () => h('div')) }],
  })
  const app = createApp(root).use(uiPlugin).use(router)
  app.mount('#table')
  onTestFinished(() => app.unmount())
  return {
    text: () => document.body.textContent ?? '',
    button: (label: string) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label),
  }
}

const columns = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status', nowrap: true },
]
const long = 'A title long enough to push every column after it out of the visible table box'

test('cells wrap so a long title cannot push the short columns out; nowrap columns stay on one line', async ({
  onTestFinished,
}) => {
  mount({ columns, rows: [{ title: long, status: 'published' }] }, onTestFinished)
  await expect.poll(() => document.querySelectorAll('tbody td').length).toBe(2)
  const [title, status] = [...document.querySelectorAll<HTMLElement>('tbody td')]
  expect(title!.className).toContain('whitespace-normal')
  expect(title!.className).not.toContain('whitespace-nowrap')
  expect(status!.className).toContain('whitespace-nowrap')
})

test('the first load says it is loading, not that there is nothing', async ({ onTestFinished }) => {
  let resolve: (page: TablePage<Row>) => void = () => {}
  const page = new Promise<TablePage<Row>>((done) => (resolve = done))
  const table = mount({ columns, load: () => page, emptyTitle: 'No pages yet.' }, onTestFinished)
  await expect.poll(table.text).toContain('Loading…')
  expect(table.text()).not.toContain('No pages yet.')
  resolve({ rows: [{ title: 'Home', status: 'draft' }], total: 1 })
  await expect.poll(table.text).toContain('Home')
  expect(table.text()).not.toContain('Loading…')
})

test('a failed load offers Try again and does not also claim the list is empty', async ({
  onTestFinished,
}) => {
  let calls = 0
  const load = async (): Promise<TablePage<Row>> => {
    calls++
    if (calls === 1) throw new Error('offline')
    return { rows: [{ title: 'Home', status: 'draft' }], total: 1 }
  }
  const table = mount(
    { columns, load, emptyTitle: 'No pages yet.', errorMessage: 'The pages could not be loaded.' },
    onTestFinished,
  )
  await expect.poll(table.text).toContain('The pages could not be loaded.')
  expect(table.text()).not.toContain('No pages yet.')
  table.button('Try again')!.click()
  await expect.poll(table.text).toContain('Home')
  expect(table.text()).not.toContain('The pages could not be loaded.')
  expect(calls).toBe(2)
})

test('a search without matches says so and Reset brings the rows back', async ({
  onTestFinished,
}) => {
  const table = mount(
    {
      columns,
      rows: [{ title: 'Home', status: 'draft' }],
      searchable: true,
      emptyTitle: 'No pages yet.',
    },
    onTestFinished,
  )
  await expect.poll(table.text).toContain('Home')
  const search = document.querySelector<HTMLInputElement>('input')!
  search.value = 'zzz'
  search.dispatchEvent(new Event('input'))
  await expect.poll(table.text).toContain('Nothing matches the search or filters.')
  expect(table.text()).not.toContain('No pages yet.')
  const reset = [...document.querySelectorAll('tbody button')].find((b) =>
    b.textContent?.includes('Reset'),
  ) as HTMLButtonElement
  reset.click()
  await expect.poll(table.text).toContain('Home')
})

type Dated = { title: string; created: string }
const dated: Dated[] = [
  { title: 'Alpha', created: '2026-11-01T09:00:00' },
  { title: 'Bravo', created: '2026-11-10T23:30:00' },
  { title: 'Charlie', created: '2026-11-20T00:00:00' },
]
const datedColumns = [{ key: 'title', label: 'Title' }]
const titles = () =>
  [...document.querySelectorAll('tbody tr')].map((tr) =>
    tr.querySelector('td:last-child')?.textContent?.trim(),
  )
const type = (label: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  input.value = value
  input.dispatchEvent(new Event('input'))
}

test('a date-range filter keeps the rows from the first to the last day, both included', async ({
  onTestFinished,
}) => {
  const table = mount(
    { columns: datedColumns, rows: dated, dateFilters: [{ key: 'created', label: 'Created' }] },
    onTestFinished,
  )
  await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie'])
  expect(document.querySelector('input[aria-label="Created from"]')?.getAttribute('type')).toBe(
    'date',
  )
  type('Created from', '2026-11-10')
  await expect.poll(titles).toEqual(['Bravo', 'Charlie'])
  type('Created to', '2026-11-10')
  await expect.poll(titles).toEqual(['Bravo'])
  table.button('Reset')!.click()
  await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie'])
})

test('server mode gets the chosen days as dateRanges and no entry for an unset filter', async ({
  onTestFinished,
}) => {
  const queries: Array<unknown> = []
  const load = async (query: { dateRanges?: unknown }): Promise<TablePage<Dated>> => {
    queries.push(query.dateRanges)
    return { rows: dated, total: 3 }
  }
  mount(
    { columns: datedColumns, load, dateFilters: [{ key: 'created', label: 'Created' }] },
    onTestFinished,
  )
  await expect.poll(() => queries).toEqual([{}])
  type('Created to', '2026-11-05')
  await expect.poll(() => queries.at(-1)).toEqual({ created: { to: '2026-11-05' } })
})

test('Move up reports the new order, announces the position and keeps focus on the row', async ({
  onTestFinished,
}) => {
  const orders: Array<Array<string>> = []
  const table = mount(
    {
      columns: datedColumns,
      load: async () => ({ rows: dated, total: 3 }),
      reorderable: true,
      onReorder: (rows: Dated[]) => orders.push(rows.map((row) => row.title)),
    },
    onTestFinished,
  )
  await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie'])
  const name = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  expect(name('Move Alpha up').disabled).toBe(true)
  expect(name('Move Charlie down').disabled).toBe(true)
  name('Move Charlie up').focus()
  name('Move Charlie up').click()
  expect(orders).toEqual([['Alpha', 'Charlie', 'Bravo']])
  await expect.poll(titles).toEqual(['Alpha', 'Charlie', 'Bravo'])
  await expect
    .poll(() => document.querySelector('[aria-live="polite"]')?.textContent?.trim())
    .toBe('Charlie moved to position 2 of 3')
  await expect
    .poll(() => document.activeElement?.getAttribute('aria-label'))
    .toBe('Move Charlie up')
  expect(table.text()).toContain('Charlie')
})

test('dropping a dragged row on another row reports the new order', async ({ onTestFinished }) => {
  const orders: Array<Array<string>> = []
  mount(
    {
      columns: datedColumns,
      rows: dated,
      reorderable: true,
      onReorder: (rows: Dated[]) => orders.push(rows.map((row) => row.title)),
    },
    onTestFinished,
  )
  await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie'])
  const rows = [...document.querySelectorAll('tbody tr')]
  rows[2]!
    .querySelector('[draggable="true"]')!
    .dispatchEvent(new Event('dragstart', { bubbles: true }))
  rows[0]!.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
  rows[0]!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  expect(orders).toEqual([['Charlie', 'Alpha', 'Bravo']])
})

test('reorder is off while a filter or a sort decides which rows show, and in which order', async ({
  onTestFinished,
}) => {
  const orders: Array<unknown> = []
  const table = mount(
    {
      columns: [{ key: 'title', label: 'Title', sortable: true }],
      rows: dated,
      dateFilters: [{ key: 'created', label: 'Created' }],
      reorderable: true,
      onReorder: (rows: Dated[]) => orders.push(rows),
    },
    onTestFinished,
  )
  const up = () => document.querySelector<HTMLButtonElement>('button[aria-label="Move Charlie up"]')
  await expect.poll(() => up()?.disabled).toBe(false)
  type('Created from', '2026-11-10')
  await expect.poll(titles).toEqual(['Bravo', 'Charlie'])
  expect(up()!.disabled).toBe(true)
  const rows = [...document.querySelectorAll('tbody tr')]
  rows[1]!.querySelector('[draggable]')!.dispatchEvent(new Event('dragstart', { bubbles: true }))
  rows[0]!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  expect(orders).toEqual([])
  table.button('Reset')!.click()
  await expect.poll(() => up()?.disabled).toBe(false)
  document.querySelector<HTMLButtonElement>('button[aria-label="Sort by Title"]')!.click()
  await expect.poll(() => up()?.disabled).toBe(true)
})

test('client mode reports every row in the new order, not only the page that shows', async ({
  onTestFinished,
}) => {
  const orders: Array<Array<string>> = []
  mount(
    {
      columns: datedColumns,
      rows: dated,
      perPage: 2,
      reorderable: true,
      onReorder: (rows: Dated[]) => orders.push(rows.map((row) => row.title)),
    },
    onTestFinished,
  )
  await expect.poll(titles).toEqual(['Alpha', 'Bravo'])
  document.querySelector<HTMLButtonElement>('button[aria-label="Move Bravo up"]')!.click()
  expect(orders).toEqual([['Bravo', 'Alpha', 'Charlie']])
  await expect
    .poll(() => document.querySelector('[aria-live="polite"]')?.textContent?.trim())
    .toBe('Bravo moved to position 1 of 3')
})

const serverTable = (onTestFinished: (fn: () => void) => void, extra: Record<string, unknown>) => {
  const asked: Array<{
    query: { page: number; dateRanges?: Record<string, unknown> }
    answer: (page: TablePage<Dated>) => void
  }> = []
  const orders: Array<Array<string>> = []
  mount(
    {
      columns: datedColumns,
      load: (query: { page: number }) =>
        new Promise<TablePage<Dated>>((answer) => asked.push({ query, answer })),
      reorderable: true,
      onReorder: (rows: Dated[]) => orders.push(rows.map((row) => row.title)),
      ...extra,
    },
    onTestFinished,
  )
  const move = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const drag = () => {
    const rows = [...document.querySelectorAll('tbody tr')]
    rows[1]?.querySelector('[draggable]')?.dispatchEvent(new Event('dragstart', { bubbles: true }))
    rows[0]?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  }
  return { asked, orders, move, drag }
}

test('reorder stays off after Reset until the unfiltered answer shows', async ({
  onTestFinished,
}) => {
  const table = serverTable(onTestFinished, {
    dateFilters: [{ key: 'created', label: 'Created' }],
  })
  await expect.poll(() => table.asked.length).toBe(1)
  table.asked[0]!.answer({ rows: dated, total: 3 })
  await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie'])
  type('Created from', '2026-11-10')
  await expect.poll(() => table.asked.length).toBe(2)
  table.asked[1]!.answer({ rows: dated.slice(1), total: 2 })
  await expect.poll(titles).toEqual(['Bravo', 'Charlie'])
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset')!.click()
  await expect.poll(() => table.asked.length).toBe(3)
  expect(titles()).toEqual(['Bravo', 'Charlie'])
  expect(table.move('Move Charlie up')!.disabled).toBe(true)
  table.drag()
  expect(table.orders).toEqual([])
  table.asked[2]!.answer({ rows: dated, total: 3 })
  await expect.poll(() => table.move('Move Charlie up')?.disabled).toBe(false)
})

test('reorder is off while the next page loads and the previous page still shows', async ({
  onTestFinished,
}) => {
  const table = serverTable(onTestFinished, { perPage: 2 })
  await expect.poll(() => table.asked.length).toBe(1)
  table.asked[0]!.answer({ rows: dated.slice(0, 2), total: 3 })
  await expect.poll(() => table.move('Move Bravo up')?.disabled).toBe(false)
  const next = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '2')!
  next.click()
  await expect.poll(() => table.asked.map((a) => a.query.page)).toEqual([1, 2])
  expect(titles()).toEqual(['Alpha', 'Bravo'])
  expect(table.move('Move Bravo up')!.disabled).toBe(true)
  table.drag()
  expect(table.orders).toEqual([])
  table.asked[1]!.answer({ rows: dated.slice(2), total: 3 })
  await expect.poll(titles).toEqual(['Charlie'])
})

test('a drag that spans a page change moves nothing: its row no longer shows', async ({
  onTestFinished,
}) => {
  const delta = { title: 'Delta', created: '2026-11-25T00:00:00' }
  const table = serverTable(onTestFinished, { perPage: 2 })
  await expect.poll(() => table.asked.length).toBe(1)
  table.asked[0]!.answer({ rows: dated.slice(0, 2), total: 4 })
  await expect.poll(titles).toEqual(['Alpha', 'Bravo'])
  document
    .querySelectorAll('tbody tr')[1]!
    .querySelector('[draggable]')!
    .dispatchEvent(new Event('dragstart', { bubbles: true }))
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '2')!.click()
  await expect.poll(() => table.asked.length).toBe(2)
  table.asked[1]!.answer({ rows: [dated[2]!, delta], total: 4 })
  await expect.poll(titles).toEqual(['Charlie', 'Delta'])
  document
    .querySelectorAll('tbody tr')[0]!
    .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  expect(table.orders).toEqual([])
  expect(titles()).toEqual(['Charlie', 'Delta'])
})
