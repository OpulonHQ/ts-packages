<script setup lang="ts">
/**
 * An amount of one currency. The user types a decimal (`12.50` or `12,50`); the model is the
 * integer number of minor units (1250), with as many decimals as the currency has.
 *
 * <FieldMoney v-model="state.priceCents" name="priceCents" currency="EUR" :label="..." />
 */
import { useLocale } from '@nuxt/ui/composables'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed, ref, watch } from 'vue'
import { srOnlyHint, type FieldProps } from '../../fields.ts'
import { formatMinor, minorDigits, parseMoney } from '../../money.ts'
import { useKitText } from '../../text.ts'

const model = defineModel<number | null>()
const props = defineProps<FieldProps & { /** ISO 4217 code, e.g. `EUR`. */ currency: string }>()

const text = useKitText()
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
const invalid = computed(() => parseMoney(typed.value, digits.value) === undefined)
watch([model, digits], () => {
  if ((parseMoney(typed.value, digits.value) ?? null) !== (model.value ?? null))
    typed.value = shown()
})
function edit(next: string) {
  typed.value = next
  model.value = parseMoney(next, digits.value) ?? null
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
    :error="invalid ? text.invalidAmount(digits) : undefined"
  >
    <UInput
      :model-value="typed"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full"
      @update:model-value="edit"
      @blur="invalid || (typed = shown())"
    >
      <template #trailing>
        <span class="text-xs text-muted">{{ currency }}</span>
      </template>
    </UInput>
  </UFormField>
</template>
