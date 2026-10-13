<script setup lang="ts">
/**
 * Confirmation modal for destructive or important actions. It does not close itself on
 * confirm: set `loading` while the action runs, then `open = false` when done.
 *
 * <ConfirmDialog v-model:open="deleting" :title="..." :description="..." danger
 *   :loading="pending" @confirm="destroy" />
 */
import UButton from '@nuxt/ui/components/Button.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { useKitText } from '../text.ts'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** Error color on the confirm button (destructive actions). */
    danger?: boolean
    /** Blocks dismissal and shows a spinner on the confirm button. */
    loading?: boolean
  }>(),
  { danger: false, loading: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
const text = useKitText()

function cancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title ?? text.areYouSure"
    :description="description"
    :dismissible="!loading"
    :close="!loading"
  >
    <slot />
    <template v-if="$slots.body" #body>
      <slot name="body" />
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="cancelLabel ?? text.cancel"
          :disabled="loading"
          @click="cancel"
        />
        <UButton
          :color="danger ? 'error' : 'primary'"
          :label="confirmLabel ?? text.confirm"
          :loading="loading"
          @click="emit('confirm')"
        />
      </div>
    </template>
  </UModal>
</template>
