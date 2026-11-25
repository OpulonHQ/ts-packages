import { expect, test } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import Turnstile from '../src/components/Turnstile.vue'

type Options = {
  sitekey: string
  action: string
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

const fake = () => {
  const widgets: Array<{ container: HTMLElement; options: Options }> = []
  const calls: Array<string> = []
  return {
    widgets,
    calls,
    api: {
      render: (container: HTMLElement, options: Options) => {
        widgets.push({ container, options })
        return `widget-${widgets.length}`
      },
      reset: (id: string) => void calls.push(`reset ${id}`),
      remove: (id: string) => void calls.push(`remove ${id}`),
    },
  }
}

const turnstile = fake()

const mount = (onTestFinished: (fn: () => void) => void) => {
  const token = ref<string>()
  const widget = ref<{ reset: () => void }>()
  document.body.innerHTML = '<div id="form"></div>'
  const app = createApp(
    defineComponent(
      () => () =>
        h(Turnstile, {
          ref: widget,
          siteKey: '1x00000000000000000000AA',
          action: 'contact',
          modelValue: token.value,
          'onUpdate:modelValue': (value: string | undefined) => {
            token.value = value
          },
        }),
    ),
  )
  app.mount('#form')
  let mounted = true
  const unmount = () => {
    if (mounted) app.unmount()
    mounted = false
  }
  onTestFinished(unmount)
  return { token, widget, unmount }
}

test("loads Cloudflare's script once and renders the widget with the site key and action", async ({
  onTestFinished,
}) => {
  const { settings } = (
    window as unknown as {
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } }
    }
  ).happyDOM
  settings.handleDisabledFileLoadingAsSuccess = true
  onTestFinished(() => {
    settings.handleDisabledFileLoadingAsSuccess = false
  })
  let reads = 0
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    get: () => (reads++ === 0 ? undefined : turnstile.api),
  })
  const first = mount(onTestFinished)
  const scripts = () => [...document.head.querySelectorAll('script')].map((s) => s.src)
  await expect
    .poll(scripts)
    .toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'])

  await expect.poll(() => turnstile.widgets.length).toBe(1)
  const { container, options } = turnstile.widgets[0]!
  expect(document.querySelector('#form')!.contains(container)).toBe(true)
  expect(options).toMatchObject({ sitekey: '1x00000000000000000000AA', action: 'contact' })
  expect(first.token.value).toBeUndefined()

  mount(onTestFinished)
  await expect.poll(() => turnstile.widgets.length).toBe(2)
  expect(scripts()).toHaveLength(1)
})

test('the model is the token: set when solved, dropped when it expires, fails or is reset', async ({
  onTestFinished,
}) => {
  const form = mount(onTestFinished)
  await expect.poll(() => turnstile.widgets.length).toBe(3)
  const { options } = turnstile.widgets[2]!

  options.callback('token-1')
  expect(form.token.value).toBe('token-1')
  options['expired-callback']()
  expect(form.token.value).toBeUndefined()

  options.callback('token-2')
  options['error-callback']()
  expect(form.token.value).toBeUndefined()

  options.callback('token-3')
  form.widget.value!.reset()
  expect(form.token.value).toBeUndefined()
  expect(turnstile.calls).toContain('reset widget-3')
  expect(turnstile.calls).not.toContain('remove widget-3')

  form.unmount()
  expect(turnstile.calls).toContain('remove widget-3')
})
