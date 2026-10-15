<script setup lang="ts">
/**
 * The page editor's left pane: page settings, then the ordered sections to select, move,
 * remove and add. Edits `sections` in place.
 */
import { useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import { computed, ref, useId } from 'vue'
import { labelText } from '../api.ts'
import { localizeData } from '../localize.ts'
import { type PageSelection, useCmsContext, usePages } from './use-cms.ts'

type DraftSection = { id: string; type: string; data: Record<string, unknown> }

const sections = defineModel<Array<DraftSection>>('sections', { required: true })
const selection = defineModel<PageSelection>('selection', { required: true })
defineProps<{ canEdit: boolean }>()

const { t, locale } = useI18n()
const { definitions } = useCmsContext()
const contentLocales = usePages().contentLocales
const heading = useId()
const newType = ref<string | number | null>(null)

const typeLabel = (type: string) => labelText(definitions.sections[type]?.label, locale.value)
const typeItems = computed(() =>
  Object.keys(definitions.sections).map((key) => ({ value: key, label: typeLabel(key) })),
)
const selected = (id: string) => selection.value.kind === 'section' && selection.value.id === id

/** The first filled text of a section in the default content locale. */
const summary = (section: DraftSection) => {
  const type = definitions.sections[section.type]
  const code = contentLocales.value[0]
  if (!type || !code) return ''
  const data = localizeData(type, section.data, code, code)
  for (const [name, field] of Object.entries(type.fields)) {
    const value = data[name]
    if ((field.kind === 'text' || field.kind === 'textarea') && typeof value === 'string' && value)
      return value
  }
  return ''
}

function move(index: number, by: -1 | 1) {
  const [section] = sections.value.splice(index, 1)
  sections.value.splice(index + by, 0, section!)
}
function remove(index: number) {
  const [removed] = sections.value.splice(index, 1)
  if (!removed || !selected(removed.id)) return
  const neighbour = sections.value[index] ?? sections.value[index - 1]
  selection.value = neighbour ? { kind: 'section', id: neighbour.id } : { kind: 'page' }
}
function add() {
  if (!newType.value) return
  const id = crypto.randomUUID()
  sections.value.push({ id, type: String(newType.value), data: {} })
  selection.value = { kind: 'section', id }
  newType.value = null
}
</script>

<template>
  <nav :aria-labelledby="heading" class="space-y-3">
    <h2 :id="heading" class="font-semibold text-highlighted">{{ t('cms.page.outline') }}</h2>
    <UButton
      :label="t('cms.page.pageSettings')"
      icon="i-lucide-settings-2"
      color="neutral"
      :variant="selection.kind === 'page' ? 'soft' : 'ghost'"
      :aria-current="selection.kind === 'page' ? 'true' : undefined"
      block
      class="justify-start"
      @click="selection = { kind: 'page' }"
    />
    <h3 class="text-sm font-medium text-muted">{{ t('cms.page.sections') }}</h3>
    <p v-if="sections.length === 0" class="text-sm text-muted">
      {{ t('cms.page.noSections') }}
    </p>
    <ol v-else class="space-y-1">
      <li v-for="(section, index) in sections" :key="section.id" class="flex items-center gap-1">
        <UButton
          color="neutral"
          :variant="selected(section.id) ? 'soft' : 'ghost'"
          :aria-current="selected(section.id) ? 'true' : undefined"
          class="min-w-0 flex-1"
          @click="selection = { kind: 'section', id: section.id }"
        >
          <span class="flex min-w-0 flex-col items-start text-left">
            <span class="font-medium">{{ index + 1 }}. {{ typeLabel(section.type) }}</span>
            <span class="w-full truncate text-xs text-muted">{{ summary(section) }}</span>
          </span>
        </UButton>
        <template v-if="canEdit">
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('cms.page.moveUp')"
            :disabled="index === 0"
            @click="move(index, -1)"
          />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('cms.page.moveDown')"
            :disabled="index === sections.length - 1"
            @click="move(index, 1)"
          />
          <UButton
            icon="i-lucide-x"
            color="error"
            variant="ghost"
            size="sm"
            :aria-label="t('cms.page.removeSection')"
            @click="remove(index)"
          />
        </template>
      </li>
    </ol>
    <div v-if="canEdit" class="flex items-end gap-2">
      <FieldSelect
        v-model="newType"
        name="newSection"
        :label="t('cms.page.sectionType')"
        :items="typeItems"
        class="min-w-0 flex-1"
      />
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        :label="t('cms.page.addSection')"
        :disabled="!newType"
        @click="add"
      />
    </div>
  </nav>
</template>
