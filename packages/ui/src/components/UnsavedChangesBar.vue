<script setup lang="ts">
/**
 * The bar an editor's unsaved changes bring up: what is going on, Discard and Save. The admin
 * shell renders it under the screen, so it stays in view however long the form is, for the
 * editor that registered with `useUnsavedChanges`; it is gone while nothing is unsaved.
 *
 * <UnsavedChangesBar :save-label="t('cms.page.save')" :busy="pending" @save="save" @discard="discard" />
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { useKitText } from '../text.ts'

withDefaults(
  defineProps<{
    /** Default "Save"; "Save draft" where publishing is a separate step. */
    saveLabel?: string
    /** A request runs: Save spins, Discard waits. */
    busy?: boolean
    /** Default "Unsaved changes". */
    message?: string
  }>(),
  { busy: false },
)
defineEmits<{ save: []; discard: [] }>()

const text = useKitText()
</script>

<template>
  <div
    role="region"
    :aria-label="message ?? text.unsavedChanges"
    class="flex flex-wrap items-center justify-end gap-2 border-t border-default bg-default px-4 py-3 sm:px-6"
  >
    <p class="me-auto flex items-center gap-2 text-sm font-medium text-highlighted">
      <span class="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
      {{ message ?? text.unsavedChanges }}
    </p>
    <UButton
      color="neutral"
      variant="ghost"
      :label="text.discard"
      :disabled="busy"
      @click="$emit('discard')"
    />
    <UButton :label="saveLabel ?? text.save" :loading="busy" @click="$emit('save')" />
  </div>
</template>
