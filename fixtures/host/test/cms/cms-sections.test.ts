import { CmsSections, createCmsClient, sectionComponents } from '@opulonjs/cms/site'
import { createApp, defineComponent, h, type PropType } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { definitions } from '../../cms/definitions.ts'
import { useAdminLifetime } from '../admin-scope.ts'
import { page, section, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom): a public page rendered from the Read API.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const Hero = defineComponent({
  props: { data: { type: Object as PropType<Record<string, unknown>>, required: true } },
  setup: (props) => () => h('h1', String(props.data['title'])),
})
const components = sectionComponents<typeof definitions>({
  hero: Hero,
  stats: defineComponent(() => () => h('p', 'stats')),
})

const render = (
  sections: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>,
) => {
  const el = document.createElement('div')
  const app = createApp(() => h(CmsSections, { sections, components }))
  app.mount(el)
  onTestFinished(() => app.unmount())
  return el
}

test('renders a resolved page’s sections in order, rich text as sanitized HTML', async () => {
  const created = await host.create(
    page({ en: '/home-page' }, [
      section('hero', { title: { en: 'Welcome' } }),
      section('rich_text', { body: { en: '<p>Hi <script>alert(1)</script><b>there</b></p>' } }),
    ]),
  )
  await host.publish(created.body.id)
  const cms = createCmsClient({ fetch: host.publicFetch, baseUrl: 'https://host.test/api/cms' })
  const resolved = await cms.resolve('/home-page')
  if (resolved.kind !== 'page') throw new Error('expected a page')

  const el = render(resolved.sections)
  expect(el.querySelector('h1')?.textContent).toBe('Welcome')
  expect(el.querySelector('.cms-rich-text')?.innerHTML).toBe('<p>Hi <b>there</b></p>')
  expect(el.querySelector('script')).toBeNull()
})

test('an unknown section type is skipped with a warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => warn.mockRestore())
  const el = render([
    { id: 'a', type: 'banner', data: {} },
    { id: 'b', type: 'stats', data: {} },
  ])
  expect(el.textContent).toBe('stats')
  expect(String(warn.mock.calls[0]?.[0])).toContain('no component for section type "banner"')
})
