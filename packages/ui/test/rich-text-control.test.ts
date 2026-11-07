import { expect, test } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import FieldRichText from '../src/components/Field/RichText.vue'
import RichTextControl from '../src/components/RichTextControl.vue'
import { UApp, uiPlugin } from '../src/index.ts'

test('a mounted rich text control follows disabled in both directions, editable and announced', async ({
  onTestFinished,
}) => {
  const state = reactive({ value: '<p>stored</p>', disabled: true })
  const root = defineComponent(
    () => () =>
      h(UApp, null, {
        default: () =>
          h(RichTextControl, {
            modelValue: state.value,
            disabled: state.disabled,
          }),
      }),
  )
  document.body.innerHTML = '<div id="rich-text"></div>'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: defineComponent(() => () => h('div')) }],
  })
  const app = createApp(root).use(uiPlugin).use(router)
  app.mount('#rich-text')
  onTestFinished(() => app.unmount())
  const editable = () => document.querySelector('.ProseMirror')?.getAttribute('contenteditable')
  const announced = () => document.querySelector('.ProseMirror')?.getAttribute('aria-disabled')

  await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('stored')
  expect(editable()).toBe('false')
  await expect.poll(announced).toBe('true')
  state.disabled = false
  await expect.poll(editable).toBe('true')
  expect(announced()).toBe('false')
  state.disabled = true
  await expect.poll(editable).toBe('false')
  await expect.poll(announced).toBe('true')
})

test('a rich text field names its editable area by the label and describes it by the field hint', async ({
  onTestFinished,
}) => {
  const root = defineComponent(
    () => () =>
      h(UApp, null, {
        default: () =>
          h(FieldRichText, {
            modelValue: '<p>Testo</p>',
            name: 'body.it',
            label: 'Text',
            srHint: 'Italian',
          }),
      }),
  )
  document.body.innerHTML = '<div id="rich-text-field"></div>'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: defineComponent(() => () => h('div')) }],
  })
  const app = createApp(root).use(uiPlugin).use(router)
  app.mount('#rich-text-field')
  onTestFinished(() => app.unmount())
  const editable = () => document.querySelector<HTMLElement>('.ProseMirror')
  await expect.poll(() => editable()?.getAttribute('aria-label')).toBe('Text')
  const ids = editable()!.getAttribute('aria-describedby')?.split(' ') ?? []
  expect(ids.map((id) => document.getElementById(id)?.textContent?.trim())).toContain('Italian')
})
