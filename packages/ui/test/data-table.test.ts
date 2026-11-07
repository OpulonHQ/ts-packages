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
