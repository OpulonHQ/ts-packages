<script setup lang="ts">
/**
 * An amount of one currency. The user types a decimal (`12.50` or `12,50`); the model is the
 * integer number of minor units (1250), with as many decimals as the currency has. The input
 * takes only text that is such an amount: an edit or a paste that is not one changes nothing,
 * so the text shown always is the model. Empty text is null.
 *
 * <FieldMoney v-model="state.priceCents" name="priceCents" currency="EUR" :label="..." />
 */
import { useLocale } from '@nuxt/ui/composables'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { srOnlyHint, type FieldProps } from '../../fields.ts'
import { formatMinor, minorDigits, parseMoney } from '../../money.ts'

const model = defineModel<number | null>()
const props = defineProps<FieldProps & { /** ISO 4217 code, e.g. `EUR`. */ currency: string }>()

const { code } = useLocale()
const digits = computed(() => minorDigits(props.currency))
const separator = computed(
  () =>
    new Intl.NumberFormat(code.value).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.',
)
const shown = () =>
  typeof model.value === 'number' ? formatMinor(model.value, digits.value, separator.value) : ''

const typed = ref(shown())
watch([model, digits], () => {
  if (parseMoney(typed.value, digits.value) !== (model.value ?? null)) typed.value = shown()
})
const control = useTemplateRef('control')
function edit(next: string) {
  const parsed = parseMoney(next, digits.value)
  if (parsed !== 'invalid') {
    typed.value = next
    model.value = parsed
    return
  }
  const input = control.value?.inputRef
  if (!input) return
  const caret = Math.max(0, (input.selectionStart ?? 0) - (next.length - typed.value.length))
  input.value = typed.value
  input.setSelectionRange(caret, caret)
}
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
    <UInput
      ref="control"
      :model-value="typed"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full"
      @update:model-value="edit"
      @blur="typed = shown()"
    >
      <template #trailing>
        <span class="text-xs text-muted">{{ currency }}</span>
      </template>
    </UInput>
  </UFormField>
</template>
