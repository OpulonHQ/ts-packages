import { defineCms } from '@opulonjs/cms/api'
import {
  CmsRichText,
  type ResolvedLink,
  type ResolvedMedia,
  type SectionData,
  sectionComponents,
} from '@opulonjs/cms/site'
import { defineComponent } from 'vue'
import type { definitions } from '../../cms/definitions.ts'

// Stand-ins: only their type matters here.
/* eslint-disable vue/one-component-per-file */
const Hero = defineComponent({})
const Stats = defineComponent({})
const Cards = defineComponent({})

sectionComponents<typeof definitions>({ hero: Hero, stats: Stats, cards: Cards })
sectionComponents<typeof definitions>({
  hero: Hero,
  stats: Stats,
  cards: Cards,
  rich_text: CmsRichText,
})

// @ts-expect-error: no component for the `stats` section type
sectionComponents<typeof definitions>({ hero: Hero, cards: Cards })

// @ts-expect-error: `banner` is not a section type of the definitions
sectionComponents<typeof definitions>({ hero: Hero, stats: Stats, cards: Cards, banner: Hero })

defineCms({
  sections: { hero: { label: 'Hero', fields: {} } },
  systemPages: {},
  templates: { landing: { label: 'Landing', sections: [{ type: 'hero' }, { type: 'rich_text' }] } },
})
defineCms({
  sections: { hero: { label: 'Hero', fields: {} } },
  systemPages: {},
  // @ts-expect-error: `banner` is not a section type of the definitions
  templates: { landing: { label: 'Landing', sections: [{ type: 'banner' }] } },
})

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type HeroData = SectionData<typeof definitions, 'hero'>
type Card = NonNullable<SectionData<typeof definitions, 'cards'>['cards']>[number]

export type InferredSectionData = [
  Expect<Equal<HeroData['title'], string | null | undefined>>,
  Expect<Equal<HeroData['image'], ResolvedMedia | null | undefined>>,
  Expect<Equal<HeroData['tone'], 'light' | 'dark' | null | undefined>>,
  Expect<Equal<Card['id'], string>>,
  Expect<Equal<Card['data']['title'], string | null | undefined>>,
  Expect<Equal<Card['data']['image'], ResolvedMedia | null | undefined>>,
  Expect<Equal<Card['data']['link'], ResolvedLink | null | undefined>>,
  Expect<Equal<SectionData<typeof definitions, 'cards'>['more'], ResolvedLink | null | undefined>>,
]
// @ts-expect-error: `price` is not a field of a card
export type NoSuchItemField = Card['data']['price']
