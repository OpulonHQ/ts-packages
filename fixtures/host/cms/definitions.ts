import { defineCms, fields } from '@opulonjs/cms/api'
import { Schema } from 'effect'

// Client-safe: imported by server/opulon.ts (cms) and admin/modules.ts (cmsAdmin).
export const definitions = defineCms({
  sections: {
    hero: {
      label: { en: 'Hero', sk: 'Úvodný blok' },
      fields: {
        title: fields.text({
          label: { en: 'Title', sk: 'Nadpis' },
          required: true,
          maxLength: 120,
        }),
        image: fields.media({ label: { en: 'Image', sk: 'Obrázok' }, accept: 'image' }),
        tone: fields.select({
          label: { en: 'Tone', sk: 'Tón' },
          options: [
            { value: 'light', label: { en: 'Light', sk: 'Svetlý' } },
            { value: 'dark', label: { en: 'Dark', sk: 'Tmavý' } },
          ],
        }),
        accent: fields.custom({
          label: { en: 'Accent colour', sk: 'Farba zvýraznenia' },
          widget: 'color',
          schema: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/)),
        }),
      },
    },
    stats: {
      label: 'Stats',
      fields: {
        count: fields.number({ label: 'Count', min: 0, max: 1000 }),
        visible: fields.boolean({ label: 'Visible' }),
        note: fields.textarea({ label: 'Note', localized: false }),
      },
    },
  },
  systemPages: {
    home: { label: { en: 'Homepage', sk: 'Domovská stránka' }, paths: { en: '/', it: '/' } },
    contact: { label: 'Contact', paths: { en: '/contact', it: '/contatti' } },
  },
  collections: {
    posts: {
      label: { en: 'Posts', sk: 'Články' },
      routed: true,
      fields: {
        title: fields.text({ label: { en: 'Title', sk: 'Nadpis' }, required: true }),
        body: fields.richText({ label: { en: 'Body', sk: 'Text' } }),
        cover: fields.media({ label: { en: 'Cover', sk: 'Obálka' }, accept: 'image' }),
        categories: fields.reference({
          label: { en: 'Categories', sk: 'Kategórie' },
          collection: 'categories',
          many: true,
        }),
      },
    },
    categories: {
      label: { en: 'Categories', sk: 'Kategórie' },
      fields: { name: fields.text({ label: { en: 'Name', sk: 'Názov' }, required: true }) },
    },
    testimonials: {
      label: 'Testimonials',
      titleField: 'author',
      fields: {
        quote: fields.textarea({ label: 'Quote', required: true }),
        author: fields.text({ label: 'Author', localized: false }),
      },
    },
  },
  settings: {
    phone: fields.text({ label: { en: 'Phone', sk: 'Telefón' }, localized: false }),
    cta: fields.link({ label: { en: 'Call to action', sk: 'Výzva k akcii' } }),
  },
  menus: {
    main: { label: { en: 'Main menu', sk: 'Hlavné menu' } },
    footer: { label: { en: 'Footer', sk: 'Päta' }, depth: 1 },
  },
  templates: {
    landing: {
      label: { en: 'Landing page', sk: 'Vstupná stránka' },
      description: {
        en: 'A hero, key numbers and an introduction.',
        sk: 'Úvodný blok, čísla a úvodný text.',
      },
      sections: [
        { type: 'hero', data: { title: { en: 'Welcome', it: 'Benvenuti' }, tone: 'dark' } },
        { type: 'stats', data: { count: 120, visible: true, note: 'Happy customers' } },
        { type: 'rich_text', data: { body: { en: '<p>Tell visitors what you offer.</p>' } } },
      ],
    },
  },
})
