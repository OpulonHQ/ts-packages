import { afterEach, expect, test } from 'vitest'
import { createApp, defineComponent, h, ref, useTemplateRef, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useFocusReturn } from '../../../../packages/cms/src/admin/use-cms.ts'
import FieldSelect from '../../../../packages/ui/src/components/Field/Select.vue'
import { UApp, uiPlugin } from '../../../../packages/ui/src/index.ts'

const unmount: Array<() => void> = []
afterEach(() => {
  for (const done of unmount.splice(0)) done()
  document.body.replaceChildren()
})

const editor = (fields: () => VNode[]) => {
  const locked = ref(false)
  const root = document.createElement('div')
  document.body.append(root)
  const screen = defineComponent(() => {
    const form = useTemplateRef<HTMLFormElement>('form')
    useFocusReturn(
      () => locked.value,
      () => form.value,
    )
    return () => h('form', { ref: 'form', tabindex: -1, 'aria-label': 'Editor' }, fields())
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  const app = createApp(() => h(UApp, null, { default: () => h(screen) }))
  app.use(uiPlugin).use(router).mount(root)
  unmount.push(() => app.unmount())
  const form = () => document.querySelector('form')!
  const reloadButton = document.createElement('button')
  document.body.append(reloadButton)
  return { locked, form, reloadButton }
}
const rendered = () => new Promise((resolve) => setTimeout(resolve))

test('focus held by a control that disappeared goes to the form, not to a hidden or select-only control', async () => {
  const { locked, form, reloadButton } = editor(() => [
    h('div', { hidden: true }, [h('input', { name: 'locales.en.path' })]),
    h('select', { name: 'native' }, [h('option', { value: 'one' }, 'One')]),
    h(FieldSelect, {
      name: 'choice',
      label: 'Choice',
      modelValue: 'one',
      items: [{ value: 'one', label: 'One' }],
    }),
  ])
  await rendered()
  reloadButton.focus()
  locked.value = true
  reloadButton.remove()
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(form())
})

test('a lock that starts inside a dialog hands focus to the form once it ends', async () => {
  const { locked, form } = editor(() => [h('input', { name: 'title' })])
  await rendered()
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const confirm = document.createElement('button')
  dialog.append(confirm)
  document.body.append(dialog)
  confirm.focus()
  locked.value = true
  dialog.remove()
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(form())
})

test('a field the response replaces right after the lock ends hands focus to the form', async () => {
  const rows = ref(['old'])
  const { locked, form } = editor(() =>
    rows.value.map((id) => h('input', { key: id, name: `items.${id}` })),
  )
  await rendered()
  const old = form().querySelector<HTMLInputElement>('input[name="items.old"]')!
  old.focus()
  locked.value = true
  old.blur()
  locked.value = false
  await Promise.resolve()
  rows.value = ['new']
  await rendered()
  expect(document.activeElement).toBe(form())
})

test('the field that had focus gets it back, and focus taken elsewhere meanwhile stays put', async () => {
  const { locked, form } = editor(() => [
    h('input', { name: 'title' }),
    h('textarea', { name: 'note' }),
  ])
  await rendered()
  const title = form().querySelector<HTMLInputElement>('input')!
  title.focus()
  locked.value = true
  title.blur()
  locked.value = false
  locked.value = true
  await rendered()
  expect(document.activeElement).toBe(document.body)
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(title)

  locked.value = true
  title.blur()
  form().querySelector('textarea')!.focus()
  locked.value = false
  await rendered()
  expect(document.activeElement?.getAttribute('name')).toBe('note')
})

test('a field still on the page but hidden meanwhile hands focus to the form', async () => {
  const hidden = ref(false)
  const { locked, form } = editor(() => [
    h('div', { style: { display: hidden.value ? 'none' : undefined } }, [
      h('input', { name: 'locales.en.path' }),
    ]),
  ])
  await rendered()
  const path = form().querySelector('input')!
  path.focus()
  locked.value = true
  path.blur()
  hidden.value = true
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(form())
})

test('a browser without checkVisibility still gives the field its focus back', async () => {
  const { locked, form } = editor(() => [h('input', { name: 'title' })])
  await rendered()
  const title = form().querySelector('input')!
  Object.defineProperty(title, 'checkVisibility', { value: undefined })
  title.focus()
  locked.value = true
  title.blur()
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(title)
})

test('a field under aria-hidden meanwhile hands focus to the form', async () => {
  const hidden = ref(false)
  const { locked, form } = editor(() => [
    h('div', { 'aria-hidden': hidden.value ? 'true' : undefined }, [h('input', { name: 'title' })]),
  ])
  await rendered()
  const title = form().querySelector('input')!
  title.focus()
  locked.value = true
  title.blur()
  hidden.value = true
  locked.value = false
  await rendered()
  expect(document.activeElement).toBe(form())
})

test('an editor closed right after its lock ends moves focus nowhere', async () => {
  const { locked, reloadButton } = editor(() => [h('input', { name: 'title' })])
  await rendered()
  reloadButton.focus()
  locked.value = true
  reloadButton.blur()
  locked.value = false
  for (const done of unmount.splice(0)) done()
  await rendered()
  expect(document.activeElement).toBe(document.body)
})
