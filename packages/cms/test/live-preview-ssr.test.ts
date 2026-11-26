import {
  CmsSections,
  type PagePreview,
  sectionComponents,
  useCmsLivePreview,
} from '@opulonjs/cms/site'
import { createSSRApp, defineComponent, h, type PropType } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test } from 'vitest'

const Hero = defineComponent({
  props: { data: { type: Object as PropType<Record<string, unknown>>, required: true } },
  setup: (props) => () => h('h1', { 'data-cms-field': 'title' }, String(props.data['title'])),
})

const initial: PagePreview = {
  id: 'page-1',
  locale: 'en',
  path: '/home',
  seo: { title: '', description: '', image: null, noindex: false },
  sections: [{ id: 's1', type: 'hero', data: { title: 'Welcome' } }],
}

test('server rendering shows the initial preview without live markers or a window', async () => {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp(
    defineComponent(() => {
      const preview = useCmsLivePreview(initial, { adminOrigin: 'https://admin.test' })
      return () =>
        preview.value &&
        h(CmsSections, {
          sections: preview.value.sections,
          components: sectionComponents<{ sections: { hero: unknown } }>({ hero: Hero }),
        })
    }),
  )
  expect(await renderToString(app)).toBe('<!--[--><h1 data-cms-field="title">Welcome</h1><!--]-->')
})

test('server rendering marks a hidden section of the initial preview', async () => {
  const app = createSSRApp(() =>
    h(CmsSections, {
      sections: [
        { id: 's1', type: 'hero', data: { title: 'Shown' } },
        { id: 's2', type: 'hero', data: { title: 'Secret' }, hidden: true },
      ],
      components: sectionComponents<{ sections: { hero: unknown } }>({ hero: Hero }),
    }),
  )
  const html = await renderToString(app)
  expect(html).toContain('<h1 data-cms-field="title">Shown</h1>')
  expect(html).toContain('<h1 data-cms-field="title" data-cms-hidden>Secret</h1>')
  expect(html.match(/<style>/g)).toHaveLength(1)
  expect(html).toContain('content:"Hidden on the site"')
})
