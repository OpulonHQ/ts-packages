<script setup lang="ts">
/**
 * Picks one record of another list. `search` gets what the user typed (empty when the list
 * opens) and answers with the matching options, usually from the server through the module's
 * `useApiClient`; the model is the picked option's value. Pass `item` for a value that is
 * already set, so its label shows before any search ran.
 *
 * <FieldRelation v-model="state.authorId" name="authorId" :label="..."
 *   :item="author && { label: author.name, value: author.id }"
 *   :search="(term) => demo((client) => client.authors({ query: { q: term } }))" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { srOnlyHint, type FieldProps, type SelectItem } from '../../fields.ts'
import { latestOnly } from '../../latest.ts'
import { useKitText } from '../../text.ts'

const model = defineModel<string | number | null>()
const props = defineProps<
  FieldProps & {
    search: (term: string) => Promise<ReadonlyArray<SelectItem>>
    item?: SelectItem | null
  }
>()
const text = useKitText()

const found = shallowRef<ReadonlyArray<SelectItem>>([])
const picked = shallowRef<SelectItem>()
const selected = computed(() =>
  [picked.value, props.item, ...found.value].find((item) => item?.value === model.value),
)
function pick(item: SelectItem | null | undefined) {
  picked.value = item ?? undefined
  model.value = item?.value ?? null
}

const open = ref(false)
const term = ref('')
const pending = ref(false)
const failed = ref(false)
const nextSearch = latestOnly()
async function load() {
  const latest = nextSearch()
  pending.value = true
  failed.value = false
  try {
    const items = await props.search(term.value.trim())
    if (latest()) found.value = items
  } catch (error) {
    if (latest()) {
      found.value = []
      failed.value = true
    }
    console.error(error)
  } finally {
    if (latest()) pending.value = false
  }
}
let debounce: ReturnType<typeof setTimeout> | undefined
watch(open, (isOpen) => {
  clearTimeout(debounce)
  if (isOpen) void load()
})
watch(term, () => {
  clearTimeout(debounce)
  if (open.value) debounce = setTimeout(load, 250)
})
</script>

<template>
  <UFormField
    :name="name"
    :label="label"
    :description="description"
    :help="help"
    :hint="hint ?? srHint"
    :ui="hint === undefined && srHint !== undefined ? srOnlyHint : undefined"
    :required="required"
    :size="size"
  >
    <USelectMenu
      v-model:open="open"
      v-model:search-term="term"
      :model-value="selected"
      :items="[...found]"
      by="value"
      label-key="label"
      ignore-filter
      :clear="!required"
      :loading="pending"
      :placeholder="placeholder ?? text.select"
      :search-input="{ placeholder: text.search }"
      :disabled="disabled"
      class="w-full"
      @update:model-value="pick"
    >
      <template #empty>
        <span :role="failed ? 'alert' : 'status'">
          {{ failed ? text.loadFailed : pending ? text.loading : text.noRecords }}
        </span>
      </template>
    </USelectMenu>
  </UFormField>
</template>
