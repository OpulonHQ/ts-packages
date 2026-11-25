import { formOptionsInjectionKey } from '@nuxt/ui/composables'
import { computed, inject } from 'vue'

/** Whether a field's own buttons are off: its `disabled` prop or the `UForm` around it. */
export const useFieldDisabled = (props: { disabled?: boolean }) => {
  const form = inject(formOptionsInjectionKey, undefined)
  return computed(() => props.disabled || form?.value.disabled || false)
}
