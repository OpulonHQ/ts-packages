import { expect, test } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import RichTextControl from '../src/components/RichTextControl.vue'
import { UApp, uiPlugin } from '../src/index.ts'

test('a mounted rich text control follows disabled in both directions', async ({
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

  await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('stored')
  expect(editable()).toBe('false')
  state.disabled = false
  await expect.poll(editable).toBe('true')
  state.disabled = true
  await expect.poll(editable).toBe('false')
})
