import FieldDate from '@opulonjs/ui/components/Field/Date'
import FieldDateTime from '@opulonjs/ui/components/Field/DateTime'
import FieldFile from '@opulonjs/ui/components/Field/File'
import FieldMoney from '@opulonjs/ui/components/Field/Money'
import FieldRelation from '@opulonjs/ui/components/Field/Relation'
import { expect, test } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type Component, type Ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nuxtUiSk, type SelectItem, UApp, UForm, uiPlugin } from '../src/index.ts'

type Finished = (fn: () => void) => void

const mount = <Value>(
  field: Component,
  props: Record<string, unknown>,
  onTestFinished: Finished,
  {
    locale,
    value,
    form = {},
  }: { locale?: typeof nuxtUiSk; value?: Value; form?: Record<string, unknown> } = {},
) => {
  const model = ref(value ?? null) as Ref<Value | null>
  const errors = ref<Array<{ name: string; message: string }>>([])
  const submitted = ref(0)
  const data = ref<unknown>()
  const fieldProps = ref(props)
  const root = defineComponent(
    () => () =>
      h(UApp, { locale }, () =>
        h(
          UForm,
          {
            state: {},
            validate: () => errors.value,
            onSubmit: (event: { data: unknown }) => {
              submitted.value++
              data.value = event.data
            },
            ...form,
          },
          () =>
            h(field, {
              name: 'value',
              label: 'Label',
              ...fieldProps.value,
              modelValue: model.value,
              'onUpdate:modelValue': (next: Value | null) => (model.value = next),
            }),
        ),
      ),
  )
  document.body.innerHTML = '<div id="field"></div>'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: defineComponent(() => () => h('div')) }],
  })
  const app = createApp(root).use(uiPlugin).use(router)
  app.mount('#field')
  onTestFinished(() => app.unmount())
  return {
    model,
    fieldProps,
    text: () => document.body.textContent ?? '',
    input: () => document.querySelector<HTMLInputElement>('input')!,
    type: (text: string) => {
      const input = document.querySelector<HTMLInputElement>('input')!
      input.value = text
      input.dispatchEvent(new Event('input'))
    },
    submitted,
    data,
    submit: () =>
      document
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    fail: (message: string) => {
      errors.value = [{ name: 'value', message }]
      document
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    },
  }
}

const noItems = async (): Promise<ReadonlyArray<SelectItem>> => []
const control = () =>
  document.querySelector<HTMLInputElement | HTMLButtonElement>(
    'input, button[aria-haspopup="listbox"]',
  )!

for (const [name, component, props] of [
  ['Date', FieldDate, {}],
  ['DateTime', FieldDateTime, {}],
  ['Money', FieldMoney, { currency: 'EUR' }],
  ['File', FieldFile, {}],
  ['Relation', FieldRelation, { search: noItems }],
] as const)
  test(`Field/${name} has its label, shows the form's error and can be disabled`, async ({
    onTestFinished,
  }) => {
    const field = mount(component, props, onTestFinished)
    const label = document.querySelector('label')!
    expect(label.textContent).toBe('Label')
    expect(label.htmlFor).toBe(control().id)
    expect(control().disabled).toBe(false)
    expect(control().tabIndex).toBe(0)
    expect(control().closest('[aria-hidden="true"]')).toBeNull()
    field.fail('Required')
    await expect.poll(field.text).toContain('Required')
    await expect.poll(() => control().getAttribute('aria-invalid')).toBe('true')
    const described = (control().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim())
    expect(described).toContain('Required')
    field.fieldProps.value = { ...props, disabled: true }
    await expect.poll(() => control().disabled).toBe(true)
  })

test('Field/Date edits a YYYY-MM-DD day in a native date input', async ({ onTestFinished }) => {
  const field = mount<string>(FieldDate, { min: '2026-01-01' }, onTestFinished, {
    value: '2026-11-25',
  })
  expect(field.input().type).toBe('date')
  expect(field.input().value).toBe('2026-11-25')
  expect(field.input().min).toBe('2026-01-01')
  field.type('2026-12-01')
  await expect.poll(() => field.model.value).toBe('2026-12-01')
  field.type('')
  await expect.poll(() => field.model.value).toBeNull()
})

test('Field/DateTime shows a UTC instant in local time and yields a UTC instant', async ({
  onTestFinished,
}) => {
  const instant = new Date(2026, 10, 25, 14, 30).toISOString()
  const field = mount<string>(FieldDateTime, {}, onTestFinished, { value: instant })
  expect(field.input().type).toBe('datetime-local')
  expect(field.input().value).toBe('2026-11-25T14:30')
  field.type('2026-12-01T08:05')
  await expect.poll(() => field.model.value).toBe(new Date(2026, 11, 1, 8, 5).toISOString())
  field.type('')
  await expect.poll(() => field.model.value).toBeNull()
})

test('Field/Money yields minor units of the currency from the typed decimal', async ({
  onTestFinished,
}) => {
  const field = mount<number>(FieldMoney, { currency: 'EUR' }, onTestFinished, { value: 1250 })
  expect(field.input().value).toBe('12.50')
  expect(field.input().getAttribute('inputmode')).toBe('decimal')
  expect(field.text()).toContain('EUR')
  for (const [typed, minor] of [
    ['1.15', 115],
    ['4.35', 435],
    ['1,1', 110],
    ['-0.07', -7],
    ['90071992547409.91', 9007199254740991],
    ['', null],
  ] as const) {
    field.type(typed)
    await expect.poll(() => field.model.value).toBe(minor)
  }
})

test('Field/Money takes the number of decimals from the currency', async ({ onTestFinished }) => {
  const field = mount<number>(FieldMoney, { currency: 'JPY' }, onTestFinished, { value: 500 })
  expect(field.input().value).toBe('500')
  field.type('1200')
  await expect.poll(() => field.model.value).toBe(1200)
  field.fieldProps.value = { currency: 'KWD' }
  await expect.poll(() => field.input().value).toBe('1.200')
  field.type('1.5')
  await expect.poll(() => field.model.value).toBe(1500)
})

test('Field/Money refuses an edit that is not an amount, so the text always is the model', async ({
  onTestFinished,
}) => {
  const field = mount<number>(FieldMoney, { currency: 'EUR' }, onTestFinished, { value: 100 })
  field.type('5')
  await expect.poll(() => field.model.value).toBe(500)
  for (const typed of ['1.234', '1 000', '1e3', 'abc', '90071992547409.92', '.5']) {
    field.type(typed)
    await expect.poll(() => field.input().value).toBe('5')
    expect(field.model.value).toBe(500)
    expect(field.input().getAttribute('aria-invalid')).not.toBe('true')
  }
  field.type('-')
  await expect.poll(() => field.model.value).toBeNull()
  expect(field.input().value).toBe('-')
  field.type('-2')
  await expect.poll(() => field.model.value).toBe(-200)
})

test('Field/Money shows the saved amount after Discard, whatever was typed before', async ({
  onTestFinished,
}) => {
  const field = mount<number>(FieldMoney, { currency: 'EUR' }, onTestFinished, { value: 100 })
  field.type('1.234')
  await nextTick()
  field.model.value = 100
  await expect.poll(() => field.input().value).toBe('1.00')
  expect(field.input().getAttribute('aria-invalid')).not.toBe('true')
  field.type('7')
  await expect.poll(() => field.model.value).toBe(700)
  field.model.value = 100
  await expect.poll(() => field.input().value).toBe('1.00')
})

test('Field/Money leaves the submit data of a schema-backed form to the schema', async ({
  onTestFinished,
}) => {
  const schema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: { note: string }) => ({ value: { note: value.note.trim() } }),
    },
  }
  const field = mount<number>(FieldMoney, { currency: 'EUR' }, onTestFinished, {
    value: 100,
    form: { state: { note: ' kept ' }, schema },
  })
  await nextTick()
  await nextTick()
  field.submit()
  await expect.poll(() => field.submitted.value).toBe(1)
  expect(field.data.value).toEqual({ note: 'kept' })
})

test('Field/Money shows the decimal separator of the admin locale', async ({ onTestFinished }) => {
  const field = mount<number>(FieldMoney, { currency: 'EUR' }, onTestFinished, {
    value: 1250,
    locale: nuxtUiSk,
  })
  expect(field.input().value).toBe('12,50')
})

const pick = (file: File) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
}

test('Field/File reports the picked file and shows its name', async ({ onTestFinished }) => {
  const field = mount<File>(
    FieldFile,
    { accept: 'application/pdf,.txt', maxSize: 1024 },
    onTestFinished,
  )
  expect(document.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe(
    'application/pdf,.txt',
  )
  const file = new File(['hello'], 'notes.TXT', { type: 'text/plain' })
  pick(file)
  await expect.poll(() => field.model.value).toBe(file)
  expect(field.model.value).toMatchObject({ name: 'notes.TXT', size: 5, type: 'text/plain' })
  await expect.poll(field.text).toContain('notes.TXT')
  document.querySelector<HTMLButtonElement>('button[aria-label="Remove notes.TXT"]')!.click()
  await expect.poll(() => field.model.value).toBeNull()
})

test('Field/File empties the native input after a pick, so only the model says which file shows', async ({
  onTestFinished,
}) => {
  const field = mount<File>(FieldFile, {}, onTestFinished)
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const emptied: Array<string> = []
  Object.defineProperty(input, 'value', { get: () => '', set: (next) => emptied.push(next) })
  const saved = new File(['a'], 'saved.pdf', { type: 'application/pdf' })
  pick(saved)
  await expect.poll(() => field.model.value).toBe(saved)
  expect(emptied).toEqual([''])
  pick(new File(['b'], 'replacement.pdf', { type: 'application/pdf' }))
  await expect.poll(field.text).toContain('replacement.pdf')
  expect(emptied).toEqual(['', ''])
  field.model.value = saved
  await expect.poll(field.text).toContain('saved.pdf')
  expect(field.text()).not.toContain('replacement.pdf')
})

test('Field/File ends a refusal when the file is removed or another one is picked', async ({
  onTestFinished,
}) => {
  const field = mount<File>(FieldFile, { maxSize: 4 }, onTestFinished)
  const input = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
  const small = new File(['ok'], 'small.txt', { type: 'text/plain' })
  pick(small)
  await expect.poll(() => field.model.value).toBe(small)
  pick(new File(['too large'], 'large.txt', { type: 'text/plain' }))
  await expect.poll(() => input().getAttribute('aria-invalid')).toBe('true')
  expect(field.model.value).toBe(small)
  document.querySelector<HTMLButtonElement>('button[aria-label="Remove small.txt"]')!.click()
  await expect.poll(() => field.model.value).toBeNull()
  await expect.poll(() => input().getAttribute('aria-invalid')).toBe('false')
  expect(field.text()).not.toContain('larger than')
  pick(new File(['too large'], 'large.txt', { type: 'text/plain' }))
  await expect.poll(() => input().getAttribute('aria-invalid')).toBe('true')
  pick(small)
  await expect.poll(() => input().getAttribute('aria-invalid')).toBe('false')
})

for (const [how, fieldProps, form] of [
  ['the field', { disabled: true }, {}],
  ['the form', {}, { disabled: true }],
] as const)
  test(`Remove and Clear are disabled with ${how}`, async ({ onTestFinished }) => {
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })
    mount<File>(FieldFile, fieldProps, onTestFinished, { value: file, form })
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Remove a.txt"]')!.disabled,
    ).toBe(true)
    mount<number>(
      FieldRelation,
      { search: noItems, item: { label: 'Cid', value: 3 }, ...fieldProps },
      onTestFinished,
      { value: 3, form },
    )
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Clear Label"]')!.disabled,
    ).toBe(true)
  })

test('Field/File refuses a file over the size limit or of another type and says why', async ({
  onTestFinished,
}) => {
  const field = mount<File>(FieldFile, { accept: 'image/*,.pdf', maxSize: 2048 }, onTestFinished)
  pick(new File(['x'.repeat(2049)], 'scan.pdf', { type: 'application/pdf' }))
  await expect.poll(field.text).toContain('The file is larger than 2 kB.')
  expect(field.model.value).toBeNull()
  pick(new File(['hi'], 'notes.txt', { type: 'text/plain' }))
  await expect.poll(field.text).toContain('This type of file is not accepted.')
  expect(field.model.value).toBeNull()
  const image = new File(['hi'], 'photo.png', { type: 'image/png' })
  pick(image)
  await expect.poll(() => field.model.value).toBe(image)
  expect(field.text()).not.toContain('not accepted')
})

const open = () => document.querySelector<HTMLElement>('button[aria-haspopup="listbox"]')!.click()
const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((el) => el.textContent?.trim())
const search = (term: string) => {
  const input = document.querySelector<HTMLInputElement>(
    '[role="listbox"] input, input[role="combobox"]',
  )!
  input.value = term
  input.dispatchEvent(new Event('input'))
}

test('Field/Relation loads its options on open, searches as typed and yields the picked value', async ({
  onTestFinished,
}) => {
  const terms: Array<string> = []
  const people = [
    { label: 'Ann', value: 1 },
    { label: 'Bea', value: 2 },
  ]
  const field = mount<number>(
    FieldRelation,
    {
      item: { label: 'Cid', value: 3 },
      search: async (term: string) => {
        terms.push(term)
        return people.filter((p) => p.label.toLowerCase().includes(term))
      },
    },
    onTestFinished,
    { value: 3 },
  )
  expect(control().textContent).toContain('Cid')
  expect(terms).toEqual([])
  open()
  await expect.poll(options).toEqual(['Ann', 'Bea'])
  search('b')
  await nextTick()
  search('be')
  await expect.poll(options).toEqual(['Bea'])
  expect(terms).toEqual(['', 'be'])
  document.querySelector<HTMLElement>('[role="option"]')!.click()
  await expect.poll(() => field.model.value).toBe(2)
  await expect.poll(() => control().textContent).toContain('Bea')
})

test('Field/Relation drops the answer of a search a newer search superseded', async ({
  onTestFinished,
}) => {
  const answers = new Map<string, (items: ReadonlyArray<SelectItem>) => void>()
  mount<number>(
    FieldRelation,
    {
      search: (term: string) =>
        new Promise<ReadonlyArray<SelectItem>>((resolve) => answers.set(term, resolve)),
    },
    onTestFinished,
  )
  open()
  await expect.poll(() => [...answers.keys()]).toEqual([''])
  search('new')
  await expect.poll(() => [...answers.keys()]).toEqual(['', 'new'])
  answers.get('new')!([{ label: 'Newer', value: 2 }])
  await expect.poll(options).toEqual(['Newer'])
  answers.get('')!([{ label: 'Older', value: 1 }])
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
  expect(options()).toEqual(['Newer'])
})

test('Field/Relation drops an answer that lands after the user typed a newer term', async ({
  onTestFinished,
}) => {
  const answers = new Map<string, (items: ReadonlyArray<SelectItem>) => void>()
  mount<number>(
    FieldRelation,
    {
      search: (term: string) =>
        new Promise<ReadonlyArray<SelectItem>>((resolve) => answers.set(term, resolve)),
    },
    onTestFinished,
  )
  open()
  await expect.poll(() => [...answers.keys()]).toEqual([''])
  search('new')
  await nextTick()
  answers.get('')!([{ label: 'Older', value: 1 }])
  await expect.poll(() => [...answers.keys()]).toEqual(['', 'new'])
  expect(options()).toEqual([])
  answers.get('new')!([{ label: 'Newer', value: 2 }])
  await expect.poll(options).toEqual(['Newer'])
})

test('Field/Relation offers no option of the previous term once a new term is typed', async ({
  onTestFinished,
}) => {
  const answers = new Map<string, (items: ReadonlyArray<SelectItem>) => void>()
  mount<number>(
    FieldRelation,
    {
      search: (term: string) =>
        new Promise<ReadonlyArray<SelectItem>>((resolve) => answers.set(term, resolve)),
    },
    onTestFinished,
  )
  open()
  await expect.poll(() => [...answers.keys()]).toEqual([''])
  answers.get('')!([{ label: 'Ann', value: 1 }])
  await expect.poll(options).toEqual(['Ann'])
  search('zzz')
  await nextTick()
  await nextTick()
  expect(options()).toEqual([])
})

test('Field/Relation has a named button that clears an optional value', async ({
  onTestFinished,
}) => {
  const field = mount<number>(
    FieldRelation,
    { search: noItems, item: { label: 'Cid', value: 3 } },
    onTestFinished,
    { value: 3 },
  )
  const clear = () => document.querySelector<HTMLButtonElement>('button[aria-label="Clear Label"]')
  expect(clear()!.tabIndex).toBe(0)
  field.fieldProps.value = { ...field.fieldProps.value, required: true }
  await expect.poll(clear).toBeNull()
  field.fieldProps.value = { ...field.fieldProps.value, required: false }
  await expect.poll(clear).not.toBeNull()
  clear()!.click()
  await expect.poll(() => field.model.value).toBeNull()
  await expect.poll(clear).toBeNull()
})

test('Field/Relation offers nothing on reopening until the new request answers', async ({
  onTestFinished,
}) => {
  const asked: Array<{ term: string; answer: (items: ReadonlyArray<SelectItem>) => void }> = []
  mount<number>(
    FieldRelation,
    {
      search: (term: string) =>
        new Promise<ReadonlyArray<SelectItem>>((answer) => asked.push({ term, answer })),
    },
    onTestFinished,
  )
  open()
  await expect.poll(() => asked.length).toBe(1)
  asked[0]!.answer([{ label: 'Ann', value: 1 }])
  await expect.poll(options).toEqual(['Ann'])
  search('be')
  await expect.poll(() => asked.length).toBe(2)
  asked[1]!.answer([{ label: 'Bea', value: 2 }])
  await expect.poll(options).toEqual(['Bea'])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  await expect.poll(() => document.querySelector('[role="option"]')).toBeNull()
  open()
  await expect.poll(() => asked.length).toBe(3)
  await nextTick()
  expect(options()).toEqual([])
  asked[2]!.answer([{ label: 'Ann', value: 1 }])
  await expect.poll(options).toEqual(['Ann'])
})

test('Field/Relation says when the search failed', async ({ onTestFinished }) => {
  const field = mount<number>(
    FieldRelation,
    { search: () => Promise.reject(new Error('offline')) },
    onTestFinished,
  )
  open()
  await expect.poll(field.text).toContain('The data could not be loaded.')
})
