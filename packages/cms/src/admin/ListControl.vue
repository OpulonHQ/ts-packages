<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { UButton, UIcon } from '@opulonjs/ui'
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'
import { type Field, labelText, maxListItems } from '../api.ts'
import { listItems } from '../localize.ts'
import FieldsForm from './FieldsForm.vue'

const model = defineModel<unknown>()
const props = defineProps<{
  field: Field
  locales: ReadonlyArray<string>
  locale?: string
  name: string
  label: string
  disabled?: boolean
}>()

const { t, locale: adminLocale } = useI18n()
const helpId = useId()
const list = useTemplateRef<HTMLOListElement>('list')
const adder = useTemplateRef<{ $el: HTMLElement }>('adder')
const dragged = ref<number>()

const items = computed(
  () => listItems(model.value) as Array<{ id: string; data: Record<string, unknown> }>,
)
const group = computed(() => ({ fields: props.field.item ?? {} }))
const max = computed(() => props.field.max ?? maxListItems)
const help = computed(() => labelText(props.field.help, adminLocale.value) || undefined)

const row = (index: number) => list.value?.children[index]
const focus = (el: HTMLElement | null | undefined) => (el ?? adder.value?.$el)?.focus()

async function place(from: number, to: number) {
  const next = [...items.value]
  next.splice(to, 0, ...next.splice(from, 1))
  model.value = next
  await nextTick()
}
async function move(index: number, by: -1 | 1) {
  await place(index, index + by)
  const enabled = (step: number) => `button[data-move="${step}"]:not(:disabled)`
  const moved = row(index + by)
  focus(moved?.querySelector<HTMLElement>(enabled(by)) ?? moved?.querySelector(enabled(-by)))
}
async function drop(event: DragEvent, index: number) {
  const from = dragged.value
  if (from === undefined) return
  event.preventDefault()
  dragged.value = undefined
  if (from !== index) await place(from, index)
}
async function remove(index: number) {
  model.value = items.value.filter((_, at) => at !== index)
  await nextTick()
  focus((row(index) ?? row(index - 1))?.querySelector<HTMLElement>('button[data-remove]'))
}
async function add() {
  model.value = [...items.value, { id: crypto.randomUUID(), data: {} }]
  await nextTick()
  focus(
    row(items.value.length - 1)?.lastElementChild?.querySelector<HTMLElement>(
      'input, textarea, select, button, [contenteditable="true"]',
    ),
  )
}
function startDrag(event: DragEvent, index: number) {
  dragged.value = index
  const item = row(index)
  if (item) event.dataTransfer?.setDragImage(item, 0, 0)
  event.dataTransfer?.setData('text/plain', '')
}
</script>

<template>
  <fieldset class="space-y-3" :aria-describedby="help ? helpId : undefined">
    <legend class="text-sm font-medium text-highlighted">{{ label }}</legend>
    <p v-if="help" :id="helpId" class="text-sm text-muted">{{ help }}</p>
    <ol v-if="items.length" ref="list" class="space-y-3">
      <li
        v-for="(item, index) in items"
        :key="item.id"
        class="space-y-3 rounded-md border border-default p-3"
        :class="dragged === index && 'opacity-50'"
        @dragover="dragged !== undefined && $event.preventDefault()"
        @drop="drop($event, index)"
      >
        <div class="flex items-center gap-1">
          <span
            v-if="!disabled"
            draggable="true"
            class="cursor-grab text-muted"
            :title="t('cms.list.drag')"
            aria-hidden="true"
            @dragstart="startDrag($event, index)"
            @dragend="dragged = undefined"
          >
            <UIcon name="i-lucide-grip-vertical" class="block size-4" />
          </span>
          <span class="flex-1 text-sm font-medium">{{ t('cms.list.item', { n: index + 1 }) }}</span>
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="ghost"
            size="sm"
            data-move="-1"
            :aria-label="t('cms.list.moveUp', { n: index + 1 })"
            :disabled="disabled || index === 0"
            @click="move(index, -1)"
          />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="ghost"
            size="sm"
            data-move="1"
            :aria-label="t('cms.list.moveDown', { n: index + 1 })"
            :disabled="disabled || index === items.length - 1"
            @click="move(index, 1)"
          />
          <UButton
            icon="i-lucide-x"
            color="error"
            variant="ghost"
            size="sm"
            data-remove
            :aria-label="t('cms.list.remove', { n: index + 1 })"
            :disabled="disabled"
            @click="remove(index)"
          />
        </div>
        <FieldsForm
          :data="item.data"
          :group="group"
          :locales="locales"
          :locale="locale"
          :name="`${name}.${index}`"
          :disabled="disabled"
        />
      </li>
    </ol>
    <UButton
      ref="adder"
      icon="i-lucide-plus"
      color="neutral"
      variant="outline"
      :label="t('cms.list.add')"
      :disabled="disabled || items.length >= max"
      @click="add"
    />
    <p v-if="items.length >= max" class="text-sm text-muted">{{ t('cms.list.full', { max }) }}</p>
  </fieldset>
</template>
