<script setup lang="ts">
/**
 * Picks one file in the browser's native file input. The model is the `File` (name, size,
 * type) and the only record of the choice: the field prints the file from it, and after every
 * pick or model change the native input is given the model's file, or none. Sending the file anywhere is the screen's job. A file over
 * `maxSize` or outside `accept` is refused with a message, until another file is picked or the
 * chosen one changes; the model stays as it was.
 *
 * <FieldFile v-model="state.scan" name="scan" accept="application/pdf,image/*"
 *   :max-size="5 * 1024 * 1024" :label="..." />
 */
import { useLocale } from '@nuxt/ui/composables'
import UButton from '@nuxt/ui/components/Button.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import { useFieldDisabled } from '../../disabled.ts'
import { srOnlyHint, type FieldProps } from '../../fields.ts'
import { formatBytes } from '../../format.ts'
import { useKitText } from '../../text.ts'

const model = defineModel<File | null>()
const props = defineProps<
  FieldProps & {
    /** As the `accept` attribute: MIME types, `image/*`, extensions (`.pdf`), comma-separated. */
    accept?: string
    /** Bytes. */
    maxSize?: number
  }
>()

const text = useKitText()
const { code } = useLocale()
const off = useFieldDisabled(props)
const accepted = (file: File) =>
  !props.accept ||
  props.accept.split(',').some((entry) => {
    const type = entry.trim().toLowerCase()
    if (type.startsWith('.')) return file.name.toLowerCase().endsWith(type)
    return type.endsWith('/*')
      ? file.type.toLowerCase().startsWith(type.slice(0, -1))
      : file.type.toLowerCase() === type
  })

const refused = ref<string>()
function pick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return show()
  refused.value =
    props.maxSize !== undefined && file.size > props.maxSize
      ? text.value.fileTooLarge(formatBytes(props.maxSize, code.value))
      : accepted(file)
        ? undefined
        : text.value.fileNotAccepted
  if (refused.value === undefined) model.value = file
  else show()
}
const control = useTemplateRef('control')
function show() {
  const input = control.value?.inputRef
  if (!input) return
  const held = new DataTransfer()
  if (model.value) held.items.add(model.value)
  input.files = held.files
}
onMounted(show)
watch(
  model,
  () => {
    refused.value = undefined
    show()
  },
  { flush: 'post' },
)
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
    :error="refused"
  >
    <UInput
      ref="control"
      type="file"
      :accept="accept"
      :disabled="disabled"
      class="w-full"
      @change="pick"
      @vue:updated="show()"
    />
    <p v-if="model" class="mt-1 flex items-center gap-1 text-sm text-muted">
      <span class="truncate">{{ model.name }}, {{ formatBytes(model.size, code) }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-x"
        :aria-label="text.removeFile(model.name)"
        :disabled="off"
        @click="model = null"
      />
    </p>
  </UFormField>
</template>
