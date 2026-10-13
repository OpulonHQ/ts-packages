// Type-level test, checked by `pnpm typecheck`: the components map must cover every section
// type of the host's definitions (`rich_text` defaults to the shipped component).
import { CmsRichText, sectionComponents } from '@opulonjs/cms/site'
import { defineComponent } from 'vue'
import type { definitions } from '../../cms/definitions.ts'

// Stand-ins: only their type matters here.
/* eslint-disable vue/one-component-per-file */
const Hero = defineComponent({})
const Stats = defineComponent({})

sectionComponents<typeof definitions>({ hero: Hero, stats: Stats })
sectionComponents<typeof definitions>({ hero: Hero, stats: Stats, rich_text: CmsRichText })

// @ts-expect-error: no component for the `stats` section type
sectionComponents<typeof definitions>({ hero: Hero })

// @ts-expect-error: `banner` is not a section type of the definitions
sectionComponents<typeof definitions>({ hero: Hero, stats: Stats, banner: Hero })
