<script setup lang="ts">
/**
 * Picks one file, by dialog or by drop. The model is the `File` (name, size, type); sending it
 * anywhere is the screen's job. A file over `maxSize` or outside `accept` is refused with a
 * message and the model stays as it was.
 *
 * <FieldFile v-model="state.scan" name="scan" accept="application/pdf,image/*"
 *   :max-size="5 * 1024 * 1024" :label="..." />
 */
import { useLocale } from '@nuxt/ui/composables'
import UFileUpload from '@nuxt/ui/components/FileUpload.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import { computed, ref } from 'vue'
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
const limit = computed(() =>
  props.maxSize === undefined ? undefined : formatBytes(props.maxSize, code.value),
)
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
const value = computed({
  get: () => model.value ?? null,
  set: (file: File | null | undefined) => {
    refused.value = !file
      ? undefined
      : props.maxSize !== undefined && file.size > props.maxSize
        ? text.value.fileTooLarge(limit.value!)
        : accepted(file)
          ? undefined
          : text.value.fileNotAccepted
    if (refused.value === undefined) model.value = file ?? null
  },
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
    :error="refused"
  >
    <UFileUpload
      v-model="value"
      :accept="accept"
      :label="placeholder ?? text.chooseFile"
      :description="limit && text.maxFileSize(limit)"
      :disabled="disabled"
      layout="list"
      class="w-full"
    />
  </UFormField>
</template>
