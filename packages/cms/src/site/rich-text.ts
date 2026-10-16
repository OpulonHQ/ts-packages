import { defineComponent, h, type PropType } from 'vue'
import type { PublicData } from '../api.ts'

/** The `rich_text` section: its body is HTML sanitized by the Read API (or by the admin, live). */
export const CmsRichText = defineComponent({
  name: 'CmsRichText',
  props: { data: { type: Object as PropType<PublicData>, required: true } },
  setup: (props) => () =>
    h('div', { class: 'cms-rich-text', innerHTML: String(props.data['body'] ?? '') }),
})
