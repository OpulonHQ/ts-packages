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
})
