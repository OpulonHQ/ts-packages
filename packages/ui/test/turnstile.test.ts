import { expect, test, vi } from 'vitest'

type Options = {
  sitekey: string
  action: string
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const scripts = () => [...document.head.querySelectorAll('script')].map((s) => s.src)
const happyDom = () =>
  (window as unknown as { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } } })
    .happyDOM.settings

const setup = async (onTestFinished: (fn: () => void) => void) => {
  vi.resetModules()
  document.head.querySelectorAll('script').forEach((script) => script.remove())
  const { createApp, defineComponent, h, ref } = await import('vue')
  const { default: Turnstile } = await import('../src/components/Turnstile.vue')
  const widgets: Array<{ container: HTMLElement; options: Options }> = []
  const calls: Array<string> = []
  const api = {
    render: (container: HTMLElement, options: Options) => {
      widgets.push({ container, options })
      return `widget-${widgets.length}`
    },
    reset: (id: string) => void calls.push(`reset ${id}`),
    remove: (id: string) => void calls.push(`remove ${id}`),
  }
  let scriptLoads = true
  let reads = 0
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    get: () => (scriptLoads && reads++ > 0 ? api : undefined),
  })
  happyDom().handleDisabledFileLoadingAsSuccess = true
  onTestFinished(() => {
    happyDom().handleDisabledFileLoadingAsSuccess = false
  })

  const mount = () => {
    const token = ref<string>()
    const widget = ref<{ reset: () => void }>()
    const host = document.body.appendChild(document.createElement('div'))
    const app = createApp(
      defineComponent(
        () => () =>
          h(
            Turnstile,
            {
              ref: widget,
              siteKey: '1x00000000000000000000AA',
              action: 'contact',
              modelValue: token.value,
              'onUpdate:modelValue': (value: string | undefined) => {
                token.value = value
              },
            },
            {
              unavailable: ({ retry }: { retry: () => void }) =>
                h('button', { id: 'retry', onClick: retry }, 'Turnstile did not load'),
            },
          ),
      ),
    )
    app.mount(host)
    let mounted = true
    const unmount = () => {
      if (mounted) app.unmount()
      mounted = false
      host.remove()
    }
    onTestFinished(unmount)
    return { host, token, widget, unmount }
  }
  return {
    mount,
    widgets,
    calls,
    blockScript: (blocked: boolean) => {
      scriptLoads = !blocked
      happyDom().handleDisabledFileLoadingAsSuccess = !blocked
    },
  }
}

test("loads Cloudflare's script once and renders the widget with the site key and action", async ({
  onTestFinished,
}) => {
  const page = await setup(onTestFinished)
  const first = page.mount()
  await expect.poll(() => page.widgets.length).toBe(1)
  expect(scripts()).toEqual([scriptUrl])
  const { container, options } = page.widgets[0]!
  expect(first.host.contains(container)).toBe(true)
  expect(options).toMatchObject({ sitekey: '1x00000000000000000000AA', action: 'contact' })
  expect(first.token.value).toBeUndefined()

  page.mount()
  await expect.poll(() => page.widgets.length).toBe(2)
  expect(scripts()).toEqual([scriptUrl])
})

test('the model is the token: set when solved, dropped when it expires, fails or is reset', async ({
  onTestFinished,
}) => {
  const page = await setup(onTestFinished)
  const form = page.mount()
  await expect.poll(() => page.widgets.length).toBe(1)
  const { options } = page.widgets[0]!

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
  expect(page.calls).toEqual(['reset widget-1'])

  form.unmount()
  expect(page.calls).toEqual(['reset widget-1', 'remove widget-1'])
})

test('a script that does not load shows the unavailable slot, and its retry loads the widget', async ({
  onTestFinished,
}) => {
  const page = await setup(onTestFinished)
  page.blockScript(true)
  const form = page.mount()
  const retry = () => form.host.querySelector<HTMLButtonElement>('#retry')
  await expect.poll(retry).not.toBeNull()
  expect(page.widgets).toEqual([])

  retry()!.click()
  await expect.poll(retry).not.toBeNull()
  expect(page.widgets).toEqual([])

  page.blockScript(false)
  retry()!.click()
  await expect.poll(() => page.widgets.length).toBe(1)
  expect(retry()).toBeNull()
  page.widgets[0]!.options.callback('token-1')
  expect(form.token.value).toBe('token-1')
})
