<script setup lang="ts">
/**
 * <FieldRichText v-model="state.body" name="body" :label="..." :toolbar="['bold', 'italic', 'link']" />
 *
 * HTML model; an empty editor is `null`. The server sanitizes what it stores.
 */
import RichTextControl from '@opulonjs/ui/components/RichTextControl'
import UFormField from '@nuxt/ui/components/FormField.vue'
import type { FieldProps, RichTextButton } from '../../fields.ts'

const model = defineModel<string | null>()

defineProps<FieldProps & { toolbar?: ReadonlyArray<RichTextButton> }>()
</script>

<template>
  <UFormField
    :name="name"
    :label="label"
    :description="description"
    :help="help"
    :hint="hint"
    :required="required"
    :size="size"
  >
    <RichTextControl v-model="model" :toolbar="toolbar" :disabled="disabled" />
  </UFormField>
</template>
