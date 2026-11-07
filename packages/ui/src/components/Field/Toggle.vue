<script setup lang="ts">
/**
 * <FieldToggle v-model="state.active" name="active" :label="..." :help="..." />
 *
 * The switch carries the label. Description, `hint` (at the end of the switch's row), `srHint`
 * and help are outside the label and describe the switch (`aria-describedby`); a form error
 * replaces that description while it shows.
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { computed, useId } from 'vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<boolean>({ default: false })

const props = defineProps<FieldProps>()

const id = useId()
const described = (error: unknown) =>
  [
    props.description && `${id}-description`,
    props.hint && `${id}-hint`,
    props.hint === undefined && props.srHint && `${id}-sr-hint`,
    props.help && !error && `${id}-help`,
  ]
    .filter(Boolean)
    .join(' ') || undefined
const hidden = computed(() => (props.hint === undefined ? props.srHint : undefined))
</script>

<template>
  <UFormField :name="name" :required="required" :size="size">
    <template #default="{ error }">
      <p v-if="description" :id="`${id}-description`" class="mb-1 text-muted">
        {{ description }}
      </p>
      <div class="flex items-center justify-between gap-1">
        <USwitch
          v-model="model"
          :label="label"
          :disabled="disabled"
          :aria-describedby="described(error)"
        />
        <span v-if="hint" :id="`${id}-hint`" class="text-muted">{{ hint }}</span>
        <span v-else-if="hidden" :id="`${id}-sr-hint`" class="sr-only">{{ hidden }}</span>
      </div>
      <p v-if="help && !error" :id="`${id}-help`" class="mt-2 text-muted">{{ help }}</p>
    </template>
  </UFormField>
</template>
