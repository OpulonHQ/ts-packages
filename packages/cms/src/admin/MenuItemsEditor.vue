<script setup lang="ts">
/** A level of a menu: each entry's label in `locale` (the editor's content language; the other
 *  locales' stay mounted and hidden), its link and its children (nested up to the menu's depth).
 *  Edits `items` in place. */
import { useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed } from 'vue'
import LinkControl from './LinkControl.vue'
import { shownLocale, useLocaleHints } from './use-cms.ts'

export interface EditedMenuItem {
  id: string
  label: Record<string, string>
  link: unknown
  children: EditedMenuItem[]
}

const items = defineModel<EditedMenuItem[]>('items', { required: true })
const props = defineProps<{
  level: number
  depth: number
  locales: ReadonlyArray<string>
  /** The content locale whose labels show; default: the first. */
  locale?: string
  /** Form path prefix, e.g. `items` or `items.0.children`. */
  name: string
  disabled?: boolean
}>()

const { t } = useI18n()
const shown = computed(() => shownLocale(props.locales, props.locale))
const hints = useLocaleHints(() => props.locales)

const add = () =>
  items.value.push({
    id: crypto.randomUUID(),
    label: {},
    link: { type: 'url', url: '' },
    children: [],
  })
function move(index: number, by: -1 | 1) {
  const [entry] = items.value.splice(index, 1)
  items.value.splice(index + by, 0, entry!)
}
</script>

<template>
  <ol class="space-y-3" :class="level > 1 ? 'ms-6 border-s border-default ps-4' : ''">
    <li v-for="(entry, index) in items" :key="entry.id" class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-highlighted">
          {{ entry.label[shown] || entry.label[locales[0] ?? ''] || t('cms.menu.untitled') }}
        </span>
        <div v-if="!disabled" class="flex gap-1">
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="ghost"
            :aria-label="t('cms.page.moveUp')"
            :disabled="index === 0"
            @click="move(index, -1)"
          />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="ghost"
            :aria-label="t('cms.page.moveDown')"
            :disabled="index === items.length - 1"
            @click="move(index, 1)"
          />
          <UButton
            icon="i-lucide-x"
            color="error"
            variant="ghost"
            :aria-label="t('cms.menu.remove')"
            @click="items.splice(index, 1)"
          />
        </div>
      </div>
      <div v-for="code in locales" v-show="code === shown" :key="code">
        <FieldText
          v-model="entry.label[code]"
          :name="`${name}.${index}.label.${code}`"
          :label="t('cms.menu.label')"
          :sr-hint="hints.language(code)"
          :disabled="disabled"
        />
      </div>
      <LinkControl
        v-model="entry.link"
        :name="`${name}.${index}.link`"
        :label="t('cms.menu.link')"
        :hint="hints.shared()"
        :disabled="disabled"
      />
      <MenuItemsEditor
        v-if="level < depth"
        v-model:items="entry.children"
        :level="level + 1"
        :depth="depth"
        :locales="locales"
        :locale="locale"
        :name="`${name}.${index}.children`"
        :disabled="disabled"
      />
    </li>
    <li v-if="!disabled">
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :label="level === 1 ? t('cms.menu.add') : t('cms.menu.addChild')"
        @click="add"
      />
    </li>
  </ol>
</template>
