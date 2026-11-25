<script setup lang="ts">
/**
 * Picks one file in the browser's native file input. The model is the `File` (name, size,
 * type) and the only record of the choice: the field prints the file from it, and the native
 * input is emptied after every pick. Sending the file anywhere is the screen's job. A file over
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
import { ref, watch } from 'vue'
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
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  refused.value =
    props.maxSize !== undefined && file.size > props.maxSize
      ? text.value.fileTooLarge(formatBytes(props.maxSize, code.value))
      : accepted(file)
        ? undefined
        : text.value.fileNotAccepted
  if (refused.value === undefined) model.value = file
}
watch(model, () => (refused.value = undefined))
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
      type="file"
      :accept="accept"
      :disabled="disabled"
      class="w-full"
      :ui="{ base: 'text-transparent' }"
      @change="pick"
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
