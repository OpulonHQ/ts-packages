import {
  CmsSections,
  type PagePreview,
  sectionComponents,
  useCmsLivePreview,
} from '@opulonjs/cms/site'
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { definitions } from '../../cms/definitions.ts'

// Runs in the `admin` vitest project (happy-dom): the site side of the admin's live preview.
const admin = 'https://admin.test'

const data = { type: Object as PropType<Record<string, unknown>>, required: true } as const
const components = sectionComponents<typeof definitions>({
  hero: defineComponent({
    props: { data },
    setup: (props) => () =>
      h('section', [h('h1', { 'data-cms-field': 'title' }, String(props.data['title'])), 'tone']),
  }),
  stats: defineComponent({
    props: { data },
    setup: (props) => () => h('p', String(props.data['note'])),
  }),
})

const initial: PagePreview = {
  id: 'page-1',
  locale: 'en',
  path: '/home',
  seo: { title: '', description: '', image: null, noindex: false },
  sections: [
    { id: 's1', type: 'hero', data: { title: 'Welcome' } },
    { id: 's2', type: 'stats', data: { note: 'Ten years' } },
  ],
}
const edited = (title: string, overrides: Readonly<Record<string, unknown>> = {}) => ({
  type: 'opulon:cms:preview',
  preview: {
    ...initial,
    sections: [{ id: 's1', type: 'hero', data: { title } }, initial.sections[1]],
    ...overrides,
  },
})

const inFrame = (search = '?preview=page-1') => {
  const parent = { postMessage: vi.fn() }
  const own = Object.getOwnPropertyDescriptor(window, 'parent')
  const href = location.href
  Object.defineProperty(window, 'parent', { get: () => parent, configurable: true })
  history.replaceState(null, '', search)
  onTestFinished(() => {
    if (own) Object.defineProperty(window, 'parent', own)
    else Reflect.deleteProperty(window, 'parent')
    history.replaceState(null, '', href)
  })
  return parent
}

const mount = (adminOrigin: string | undefined) => {
  const el = document.createElement('div')
  document.body.append(el)
  let result: ReturnType<typeof useCmsLivePreview> | undefined
  const app = createApp(
    defineComponent(() => {
      const preview = useCmsLivePreview(initial, { adminOrigin })
      result = preview
      return () => preview.value && h(CmsSections, { sections: preview.value.sections, components })
    }),
  )
  app.mount(el)
  let mounted = true
  const unmount = () => {
    if (mounted) app.unmount()
    mounted = false
    el.remove()
  }
  onTestFinished(unmount)
  return {
    el,
    unmount,
    title: () => el.querySelector('h1')?.textContent,
    preview: () => result?.value,
  }
}

const send = async (
  message: unknown,
  origin = admin,
  source: MessageEventSource = window.parent,
) => {
  window.dispatchEvent(new window.MessageEvent('message', { data: message, origin, source }))
  await nextTick()
}

const click = (target: Node) => {
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

test('a page in the top window (no frame) stays inert', async () => {
  history.replaceState(null, '', '?preview=page-1')
  onTestFinished(() => history.replaceState(null, '', '/'))
  const site = mount(admin)
  await send(edited('Changed'), admin, window)
  expect(site.title()).toBe('Welcome')
  expect(site.el.querySelector('[data-cms-section]')).toBeNull()
})

test.each([
  ['no admin origin', undefined],
  ['a wildcard', '*'],
  ['a non-http origin', 'file:///admin'],
  ['a script url', 'javascript:alert(1)'],
])('%s as the admin origin stays inert', async (_, adminOrigin) => {
  const parent = inFrame()
  const site = mount(adminOrigin)
  await send(edited('Changed'), 'null')
  await send(edited('Changed'), admin)
  expect(site.title()).toBe('Welcome')
  expect(site.el.querySelector('[data-cms-section]')).toBeNull()
  expect(parent.postMessage).not.toHaveBeenCalled()
})

test('a framed page without ?preview stays inert', async () => {
  const parent = inFrame('/home')
  const site = mount(admin)
  await send(edited('Changed'))
  expect(site.title()).toBe('Welcome')
  expect(parent.postMessage).not.toHaveBeenCalled()
})

test('in preview, posts ready to the admin origin and marks every section root', async () => {
  const parent = inFrame()
  const site = mount(`${admin}/`)
  expect(parent.postMessage.mock.calls).toEqual([[{ type: 'opulon:cms:ready' }, admin]])
  await nextTick()
  expect(
    [...site.el.querySelectorAll('[data-cms-section]')].map((e) => [
      e.tagName,
      e.getAttribute('data-cms-section'),
    ]),
  ).toEqual([
    ['SECTION', 's1'],
    ['P', 's2'],
  ])
})

test('a valid preview from the admin re-renders the sections', async () => {
  inFrame()
  const site = mount(admin)
  await send(edited('Hello from the editor'))
  expect(site.title()).toBe('Hello from the editor')
  expect(site.el.textContent).toBe('Hello from the editortoneTen years')
})

test.each([
  ['a wrong origin', edited('Wrong'), 'https://evil.test', undefined],
  ['a wrong source', edited('Wrong'), admin, new MessageChannel().port1],
  [
    'a malformed seo',
    edited('Wrong', { seo: { ...initial.seo, noindex: 'no' } }),
    admin,
    undefined,
  ],
  [
    'a section without data',
    edited('Wrong', { sections: [{ id: 's1', type: 'hero' }] }),
    admin,
    undefined,
  ],
  ['another page', edited('Wrong', { id: 'page-2' }), admin, undefined],
  ['another locale', edited('Wrong', { locale: 'sk' }), admin, undefined],
])('%s leaves the preview unchanged', async (_, message, origin, source) => {
  inFrame()
  const site = mount(admin)
  await send(message, origin, source ?? window.parent)
  expect(site.title()).toBe('Welcome')
  await send(edited('Accepted'))
  expect(site.title()).toBe('Accepted')
})

test('a click inside a field selects its section and field, and does nothing else', async () => {
  const parent = inFrame()
  const site = mount(admin)
  await nextTick()
  parent.postMessage.mockClear()
  const h1 = site.el.querySelector('h1')
  if (!h1?.firstChild) throw new Error('expected the hero title')
  const event = click(h1.firstChild)
  expect(event.defaultPrevented).toBe(true)
  expect(parent.postMessage.mock.calls).toEqual([
    [{ type: 'opulon:cms:select', sectionId: 's1', field: 'title' }, admin],
  ])
})

test('a click on a section outside any field selects the section', async () => {
  const parent = inFrame()
  const site = mount(admin)
  await nextTick()
  parent.postMessage.mockClear()
  const stats = site.el.querySelector('p')
  if (!stats) throw new Error('expected the stats section')
  expect(click(stats).defaultPrevented).toBe(true)
  expect(parent.postMessage.mock.calls).toEqual([
    [{ type: 'opulon:cms:select', sectionId: 's2' }, admin],
  ])
})

test('a click outside the sections posts nothing', async () => {
  const parent = inFrame()
  mount(admin)
  await nextTick()
  parent.postMessage.mockClear()
  const stray = document.createElement('div')
  stray.setAttribute('data-cms-section', 'not-a-section')
  document.body.append(stray)
  onTestFinished(() => stray.remove())
  expect(click(document.body).defaultPrevented).toBe(false)
  expect(click(stray).defaultPrevented).toBe(false)
  expect(parent.postMessage).not.toHaveBeenCalled()
})

test('after unmount, messages and clicks do nothing', async () => {
  const parent = inFrame()
  const site = mount(admin)
  await nextTick()
  site.unmount()
  parent.postMessage.mockClear()
  await send(edited('Late'))
  expect(site.preview()?.sections[0]?.data).toEqual({ title: 'Welcome' })
  const stale = document.createElement('section')
  stale.setAttribute('data-cms-section', 's1')
  document.body.append(stale)
  onTestFinished(() => stale.remove())
  expect(click(stale).defaultPrevented).toBe(false)
  expect(parent.postMessage).not.toHaveBeenCalled()
})
