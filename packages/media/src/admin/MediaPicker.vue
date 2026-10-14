<script setup lang="ts">
/**
 * Picks one media item from the library (archived items excluded); `v-model` is its id or null.
 *
 * <MediaPicker v-model="state.heroImage" :label="t('site.hero')" accept="image" />
 */
import { useI18n } from '@opulonjs/admin'
import { UButton, UIcon, UModal } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import { computed, ref, shallowRef, watch } from 'vue'
import type { MediaItem } from '../api.ts'
import { accept as acceptTypes, failureMessage, useMedia } from './use-media.ts'

const model = defineModel<string | null>({ default: null })
const props = defineProps<{
  label?: string
  /** Only images or only PDFs; default both. */
  accept?: 'image' | 'pdf'
  /**
   * An upload that finishes while disabled is picked once enabled again, so an instance belongs
   * to one field: to point the picker at another field, key it by that field (`:key`) so the
   * old instance unmounts and drops what it holds.
   */
  disabled?: boolean
}>()

const { t } = useI18n()
const media = useMedia()
const open = ref(false)
const item = shallowRef<MediaItem>()
const failure = ref<string>()
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()

watch(
  model,
  async (id) => {
    if (!id) return (item.value = undefined)
    if (item.value?.id === id) return
    try {
      const next = await media.get(id)
      if (model.value === id) item.value = next
    } catch (error) {
      if (model.value !== id) return
      item.value = undefined
      failure.value = failureMessage(error, t('media.errors.failed'))
    }
  },
  { immediate: true },
)

const load = media.load({ status: 'active', ...(props.accept ? { type: props.accept } : {}) })
const columns = computed(() => [
  { key: 'preview', label: t('media.columns.preview') },
  { key: 'filename', label: t('media.columns.filename') },
])

// Picking while disabled would write into a draft that the pending save is about to replace.
let held: MediaItem | undefined
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled || !held) return
    const uploaded = held
    held = undefined
    pick(uploaded)
  },
)

function pick(row: MediaItem) {
  item.value = row
  model.value = row.id
  failure.value = undefined
  open.value = false
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  failure.value = undefined
  try {
    const uploaded = await media.upload(file)
    if (props.disabled) held = uploaded
    else pick(uploaded)
  } catch (error) {
    failure.value = failureMessage(error, t('media.errors.failed'))
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="label" class="text-sm font-medium text-default">{{ label }}</p>
    <div class="flex items-center gap-3">
      <template v-if="item">
        <img
          v-if="item.mime !== 'application/pdf'"
          :src="item.url"
          alt=""
          class="size-16 rounded bg-elevated object-cover"
        />
        <UIcon v-else name="i-lucide-file-text" class="size-10 text-muted" />
        <span class="min-w-0 truncate text-sm">{{ item.filename }}</span>
      </template>
      <span v-else class="text-sm text-muted">{{ t('media.picker.none') }}</span>
    </div>
    <div class="flex gap-2">
      <UButton
        size="sm"
        variant="outline"
        icon="i-lucide-images"
        :label="item ? t('media.picker.change') : t('media.picker.choose')"
        :disabled="disabled"
        @click="open = true"
      />
      <UButton
        v-if="model"
        size="sm"
        color="neutral"
        variant="ghost"
        :label="t('media.picker.clear')"
        :disabled="disabled"
        @click="model = null"
      />
    </div>
    <p v-if="failure && !open" role="alert" class="text-sm text-error">{{ failure }}</p>

    <UModal v-model:open="open" :title="t('media.picker.title')" class="sm:max-w-3xl">
      <template #body>
        <p v-if="failure" role="alert" class="mb-3 text-sm text-error">{{ failure }}</p>
        <DataTable
          :columns="columns"
          :load="load"
          :caption="t('media.picker.title')"
          :empty-title="t('media.library.empty')"
          :per-page="10"
          searchable
          :on-row-click="pick"
        >
          <template #toolbar>
            <UButton
              v-if="media.can('media.upload')"
              icon="i-lucide-upload"
              :label="t('media.library.upload')"
              :loading="uploading"
              @click="fileInput?.click()"
            />
            <input
              ref="fileInput"
              type="file"
              class="sr-only"
              tabindex="-1"
              :aria-label="t('media.library.upload')"
              :accept="acceptTypes(accept)"
              @change="upload"
            />
          </template>
          <template #preview-cell="{ row }">
            <img
              v-if="row.original.mime !== 'application/pdf'"
              :src="row.original.url"
              alt=""
              loading="lazy"
              class="size-10 rounded bg-elevated object-cover"
            />
            <UIcon v-else name="i-lucide-file-text" class="size-6 text-muted" />
          </template>
        </DataTable>
      </template>
    </UModal>
  </div>
</template>
