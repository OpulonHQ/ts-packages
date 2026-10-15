import {
  CmsSections,
  createCmsClient,
  type PagePreview,
  type PublicData,
  sectionComponents,
  useCmsLivePreview,
} from '@opulonjs/cms/site'
import { createApp, defineComponent, h, type PropType, shallowRef } from 'vue'
import type { definitions } from '../cms/definitions.ts'

// The admin's live preview target: /site/?preview=<page id>&locale=<locale>, framed by the
// page editor on the same origin, so the editor's session cookie loads the draft.
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

const data = { type: Object as PropType<PublicData>, required: true } as const

const Hero = defineComponent({
  props: { data },
  setup: (props) => () =>
    h('section', { class: `hero-${text(props.data['tone']) || 'light'}` }, [
      h('h1', { 'data-cms-field': 'title' }, text(props.data['title'])),
      h('p', { 'data-cms-field': 'tone' }, text(props.data['tone'])),
    ]),
})

const Stats = defineComponent({
  props: { data },
  setup: (props) => () =>
    h('section', [
      h('strong', { 'data-cms-field': 'count' }, text(props.data['count'])),
      h('p', { 'data-cms-field': 'note' }, text(props.data['note'])),
    ]),
})

const components = sectionComponents<typeof definitions>({ hero: Hero, stats: Stats })
const params = new URLSearchParams(location.search)
const cms = createCmsClient({ fetch: (input, init) => fetch(input, init) })

const App = defineComponent(() => {
  const initial = shallowRef<PagePreview>()
  const failed = shallowRef(false)
  cms.previewPage(params.get('preview') ?? '', params.get('locale') ?? undefined).then(
    (preview) => (initial.value = preview),
    () => (failed.value = true),
  )
  const preview = useCmsLivePreview(initial, { adminOrigin: location.origin })
  return () =>
    preview.value
      ? h(CmsSections, { sections: preview.value.sections, components })
      : failed.value
        ? h(
            'p',
            { role: 'alert' },
            'This page preview could not be loaded. Sign in to the admin and reload.',
          )
        : null
})

createApp(App).mount('#app')
