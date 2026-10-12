import { useLocale } from '@nuxt/ui/composables'
import { computed } from 'vue'
import type { RichTextButton } from './fields.ts'

// The kit's own strings, picked by the Nuxt UI locale that `<UApp :locale>` sets (the admin
// shell passes the user's admin locale). Unknown locales fall back to English.
const en = {
  confirm: 'Confirm',
  cancel: 'Cancel',
  areYouSure: 'Are you sure?',
  search: 'Search…',
  select: 'Select…',
  selectAll: 'Select all rows',
  selectRow: 'Select row',
  sortBy: (label: string) => `Sort by ${label}`,
  noRecords: 'No records found',
  loadFailed: 'The data could not be loaded.',
  range: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
  perPage: 'Rows per page',
  resetFilters: 'Reset',
  link: 'Link',
  linkApply: 'Apply',
  linkRemove: 'Remove',
  tools: {
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    link: 'Link',
    bulletList: 'Bullet list',
    orderedList: 'Numbered list',
    h2: 'Heading 2',
    h3: 'Heading 3',
    blockquote: 'Quote',
    undo: 'Undo',
    redo: 'Redo',
  } satisfies Record<RichTextButton, string>,
}

export type KitText = typeof en

const sk: KitText = {
  confirm: 'Potvrdiť',
  cancel: 'Zrušiť',
  areYouSure: 'Naozaj?',
  search: 'Hľadať…',
  select: 'Vyberte…',
  selectAll: 'Vybrať všetky riadky',
  selectRow: 'Vybrať riadok',
  sortBy: (label) => `Zoradiť podľa: ${label}`,
  noRecords: 'Žiadne záznamy',
  loadFailed: 'Údaje sa nepodarilo načítať.',
  range: (from, to, total) => `${from}–${to} z ${total}`,
  perPage: 'Riadkov na stranu',
  resetFilters: 'Zrušiť filtre',
  link: 'Odkaz',
  linkApply: 'Použiť',
  linkRemove: 'Odstrániť',
  tools: {
    bold: 'Tučné',
    italic: 'Kurzíva',
    underline: 'Podčiarknuté',
    strike: 'Prečiarknuté',
    link: 'Odkaz',
    bulletList: 'Odrážkový zoznam',
    orderedList: 'Číslovaný zoznam',
    h2: 'Nadpis 2',
    h3: 'Nadpis 3',
    blockquote: 'Citát',
    undo: 'Späť',
    redo: 'Znova',
  },
}

const texts: Record<string, KitText> = { en, sk }

/** The kit's strings in the current Nuxt UI locale. */
export const useKitText = () => {
  const { code } = useLocale()
  return computed(() => texts[code.value] ?? en)
}
