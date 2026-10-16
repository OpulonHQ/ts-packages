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
