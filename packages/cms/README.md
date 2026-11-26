# @opulonjs/cms

## Keep a section type next to its component

A section type's fields are registered once, in `defineCms({ sections })`. The admin builds the
section's form from them and the server validates against them, so there is no second
registration in the component. To keep the two in one place, export the `SectionType` object
from a file next to the component and import it into your definitions:

```ts
// site/sections/hero.ts
import { fields, type SectionType } from '@opulonjs/cms/api'

export const hero = {
  label: { en: 'Hero', sk: 'Úvodný blok' },
  fields: {
    title: fields.text({ label: 'Title', required: true }),
    tone: fields.select({ label: 'Tone', options: [{ value: 'dark', label: 'Dark' }] }),
  },
} satisfies SectionType
```

```ts
// cms/definitions.ts
import { defineCms } from '@opulonjs/cms/api'
import { hero } from '../site/sections/hero.ts'

export const definitions = defineCms({ sections: { hero }, systemPages: {} })
```

`Hero.vue` sits next to `hero.ts` and receives the localized data as its `data` prop.

## Repeat items in a list field

`fields.list` holds repeated items, each with its own fields. Use it in a section type, a
collection or the site settings, for cards, FAQ entries, steps or testimonials:

```ts
cards: {
  label: 'Cards',
  fields: {
    cards: fields.list({
      label: 'Cards',
      min: 1,
      max: 6,
      item: {
        title: fields.text({ label: 'Title', required: true }),
        image: fields.media({ label: 'Image', accept: 'image' }),
        link: fields.link({ label: 'Link' }),
      },
    }),
  },
}
```

An item holds any field kind except a list, and each item field is localized or not, as at the
top level. Editors add, remove and reorder items with buttons or by dragging the grip. A save
refuses more than `max` items (100 when unset). Publishing needs at least `min` items and every
item's required fields, in each available locale or in the default one.

A list is stored as `[{ id, data }]` in the editor's order; `data` is stored like a section's
data, so a localized item field holds `{ [locale]: value }`. The server keeps each item's id
across saves, reorders and revisions. The Read API returns `[{ id, data }]` in one locale, with
media and links inside items resolved like top-level ones. A page preview (the preview endpoint
and the live preview) gives sections the same shape.

`SectionData` types a section component's `data` prop from the definitions, list items included:

```vue
<script setup lang="ts">
import type { SectionData } from '@opulonjs/cms/site'
import type { definitions } from '../../cms/definitions.ts'

defineProps<{ data: SectionData<typeof definitions, 'cards'> }>()
</script>

<template>
  <ul>
    <li v-for="card in data.cards" :key="card.id">
      <a :href="card.data.link?.href ?? undefined">{{ card.data.title }}</a>
    </li>
  </ul>
</template>
```

`PublicDataOf<typeof definitions.collections.posts>` does the same for a collection's data.

## Filter a collection's admin list

Name the reference and select fields editors filter a collection's list by:

```ts
collections: {
  posts: {
    label: 'Posts',
    filters: ['categories'],
    fields: {
      title: fields.text({ label: 'Title' }),
      categories: fields.reference({ label: 'Categories', collection: 'categories', many: true }),
    },
  },
}
```

The Collections screen shows one filter per named field above the table: a select offers its
options, a reference the first 100 items of its collection by title. A list matches the items
whose draft holds the chosen value (a many reference: among its items). The Admin API takes the
same filter as `GET /collections/posts/items?filter=categories:<item id>`, repeatable, and
answers 400 for a field `filters` does not name.

## Publish in some languages

A page or item is published in the content locales its `locales[<locale>].available` holds. The
editors show them as one Languages control, a checkbox per content locale. A routed document
needs a path in each locale it is available in; an unrouted item is available in a locale its
document does not name, and the Read API's `collection()` lists it only in its available locales.

Admin lists show each row in its list locale: the default locale when available there, else the
first available one, so the title and the public path (`/it/contatti`) are that locale's. Rows
carry `locales`, the available ones, and `GET /collections/:collection/items?availableIn=it`
lists the items available in Italian.

Publishing needs each required localized field filled in every available locale, or in the
default locale, which the Read API falls back to.

## Live preview

The page editor can show the host site's page in a frame and update it as the editor types,
before anything is saved. The admin sends the unsaved draft to `POST /pages/:id/preview`, which
renders it as `GET /pages/:id/preview` renders the saved one, and posts the answer to the frame.
When that request fails, the pane says so and the frame keeps the last draft it got.

1. In the admin, tell `cmsAdmin` where a page's preview lives. The URL is absolute or relative to
   the admin; the admin posts only to its origin and accepts messages only from it.

   ```ts
   cmsAdmin({
     definitions,
     preview: {
       url: ({ id, path, locale }) =>
         `https://www.example.com${path}?preview=${id}&locale=${locale}`,
     },
   })
   ```

   Without `preview` the editor shows the section list and the inputs only. `path` is the saved
   path of that locale, so typing a new path does not reload the frame.

2. On the site's preview route, read the draft as today and pass it through `useCmsLivePreview`
   in the component that renders `CmsSections` (or a parent of it):

   ```vue
   <script setup lang="ts">
   import { CmsSections, useCmsLivePreview } from '@opulonjs/cms/site'

   const { data } = await useAsyncData(() => cms.previewPage(id, locale))
   const preview = useCmsLivePreview(data, { adminOrigin: 'https://admin.example.com' })
   </script>

   <template>
     <CmsSections v-if="preview" :sections="preview.sections" :components="components" />
   </template>
   ```

   The composable does nothing unless the page runs in a frame, its URL has `?preview` and
   `adminOrigin` is an `http(s)` origin. Section markers and click handling start once the
   admin posts a draft of the page shown, so a site that frames the page itself, or a frame
   showing another page, changes nothing. It renders
   the draft the admin posts for the same page as `initial` (none while `initial` is empty), in
   the language chosen in the admin, and ignores messages from any other origin or window. When
   `initial` turns into another page, it drops the draft and asks the admin for a fresh one.
   The options may be reactive: when the URL loses `?preview` or `adminOrigin` stops being
   valid, it drops the draft, the section markers and the click handling. A URL change is seen
   at once on back and forward navigation and, where the browser has the Navigation API, on
   `pushState` and `replaceState`. Without the Navigation API, a `pushState` or `replaceState`
   that drops `?preview` takes effect at the next message or click, and one that adds it is not
   seen until the next load or back and forward navigation.
   During SSR and hydration it renders `initial` unchanged.

3. Optionally mark the parts of a section component with the field they show. A click on a
   marked element selects the section and focuses that field's input; a click elsewhere in the
   section focuses its first input.

   ```vue
   <template>
     <section>
       <h1 data-cms-field="title">{{ data.title }}</h1>
     </section>
   </template>
   ```

In the preview, `CmsSections` adds `data-cms-section` to each section component's root element,
so a section component needs a single root element to be clickable. Clicks inside sections do
not follow links. The posted data is the unsaved draft: fields the editor has not filled are
missing, and media and link fields are resolved as the Read API resolves them.
The posted draft is cleaned as Save cleans it (rich text sanitized, URL links and SEO text
trimmed, empty values dropped), whichever widget produced it. A URL link Save would refuse
(not `https://`, `http://`, `mailto:`, `tel:`, `/` or `#`) is left out of the preview.

## Hide a section

Each section in the page editor has a **Hide on the site** switch, whatever its type. A hidden
section keeps its content in the draft, and the document stores `hidden: true` on it. The Read
API's `resolve()` leaves it out, so neither the public page nor its server-rendered HTML holds
it. The page preview keeps it with `hidden: true`, and `CmsSections` renders its root with
`data-cms-hidden` plus one `<style>` that outlines it, fades it and labels it "Hidden on the
site". Override `[data-cms-hidden]` in the site's CSS to style it differently.

Hiding and showing are draft changes like any other: they reach the site on publish and a
discarded draft undoes them. The switch is per section, not per locale. A section without the
key is visible, and showing a section again removes the key, so a page hidden and shown back
equals its published version.

## Sitemap limits

The public `GET <apiPrefix>/cms/sitemap.xml` index links the files served by
`GET <apiPrefix>/cms/sitemaps/<name>.xml`. CMS pages, routed collections and module
contributions each supply a source. Empty sources retain one empty child.

Children contain at most 50,000 URLs and 10,000,000 uncompressed UTF-8 bytes.
The byte cap is below the [sitemaps protocol's
52,428,800-byte maximum](https://www.sitemaps.org/protocol.html) to leave memory
for source rows, serialization and response encoding within a Worker's 128 MB
isolate limit. Sizing counts the exact XML declaration, wrappers, lastmod,
escaped URLs, alternate links and x-default. A single entry too large to fit
fails the request instead of producing invalid XML.

Generation materializes each source's full list. Both the index and a child
request scan and serialize the full source to determine boundaries; the child
then renders its selected entries. The cap bounds child output, not source
memory or request CPU. Avoid relying on the Workers Free tier's 10 ms CPU
allowance for large sources. Use Workers Paid with a suitable budget and verify
production CPU and memory, or pre-generate large sitemap files outside the
request path. Paid defaults to 30 seconds of CPU and allows up to 300 seconds;
every isolate has 128 MB of memory. These [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
were checked on 2026-10-13. Concurrent requests and longer entries increase the
memory requirement.

## Child naming

A source that fits uses `<key>.xml`; a split source uses `<key>-1.xml`,
`<key>-2.xml`, and so on. Contributors must return entries in deterministic order.
Child URLs stay stable for the same source entries and request origin. Changes
to content or origin can change the split boundaries and filenames.
