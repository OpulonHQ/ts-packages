import { type Component, defineComponent, h, type PropType, warn } from 'vue'
import type { PublicData } from '../api.ts'
import { CmsRichText } from './rich-text.ts'

/** Section types of a host's cms definitions (`typeof definitions`). */
type SectionKeys<D extends { readonly sections: object }> = Extract<keyof D['sections'], string>

/** A component per section type; `rich_text` defaults to `CmsRichText`. */
export type SectionComponents<D extends { readonly sections: object }> = {
  readonly [K in Exclude<SectionKeys<D>, 'rich_text'>]: Component
} & { readonly rich_text?: Component }

declare const covered: unique symbol
/** A components map checked against the host's definitions; made by `sectionComponents`. */
export type SectionComponentMap = Readonly<Record<string, Component>> & {
  readonly [covered]: true
}

/**
 * The components `<CmsSections>` renders, one per section type of the host's definitions, so a
 * section type without a component fails typecheck:
 * `sectionComponents<typeof definitions>({ hero: Hero, stats: Stats })`.
 * Type-only: the definitions (and Effect) stay out of the public bundle.
 */
export const sectionComponents = <D extends { readonly sections: object }>(
  components: SectionComponents<D>,
) => ({ rich_text: CmsRichText, ...components }) as unknown as SectionComponentMap

export interface CmsSection {
  readonly id: string
  readonly type: string
  readonly data: PublicData
}

/**
 * Renders a page's sections in order, each as its type's component with a `data` prop. An
 * unknown type (a section type the site does not render yet) warns in dev and is skipped.
 */
export const CmsSections = defineComponent({
  name: 'CmsSections',
  props: {
    sections: { type: Array as PropType<ReadonlyArray<CmsSection>>, required: true },
    components: { type: Object as PropType<SectionComponentMap>, required: true },
  },
  setup: (props) => () =>
    props.sections.map((section) => {
      const component = props.components[section.type]
      if (component) return h(component, { key: section.id, data: section.data })
      warn(`CmsSections: no component for section type "${section.type}"`)
      return null
    }),
})
