<script setup lang="ts">
/**
 * Content > Media: the flat library with search, type and archived filters, upload and details in
 * a slideover that asks before unsaved alt text or captions are lost.
 */
import { CachePurgeNotice, useCloseGuard, useI18n } from '@opulonjs/admin'
import { formatDate, UButton, UIcon, USlideover } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref, shallowRef } from 'vue'
import type { MediaItem } from '../api.ts'
import MediaDetails from './MediaDetails.vue'
import { accept, failureMessage, formatSize, useMedia } from './use-media.ts'

const { t, locale } = useI18n()
const media = useMedia()
const table = ref<{ refresh: () => void }>()
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const failure = ref<string>()
const selected = shallowRef<MediaItem>()
const details = ref<{ dirty: boolean }>()
const { open, dismissible, close, leave } = useCloseGuard({
  isOpen: () => selected.value !== undefined,
  close: () => (selected.value = undefined),
  dirty: () => details.value?.dirty ?? false,
})

const load = media.load()
const columns = computed(() => [
  { key: 'preview', label: t('media.columns.preview') },
  { key: 'filename', label: t('media.columns.filename') },
  { key: 'mime', label: t('media.columns.type') },
  {
    key: 'size',
    label: t('media.columns.size'),
    format: (v: unknown) => formatSize(Number(v), locale.value),
  },
  {
    key: 'updatedAt',
    label: t('media.columns.updatedAt'),
    nowrap: true,
    format: (v: unknown) => formatDate(v, locale.value),
  },
])
const filters = computed(() => [
  {
    key: 'type',
    label: t('media.filters.type'),
    options: [
      { label: t('media.filters.image'), value: 'image' },
      { label: t('media.filters.pdf'), value: 'pdf' },
    ],
  },
  {
    key: 'status',
    label: t('media.filters.status'),
    options: [
      { label: t('media.filters.active'), value: 'active' },
      { label: t('media.filters.archived'), value: 'archived' },
    ],
  },
])

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  // Each upload opens in the details: ask before it would replace unsaved text, not after.
  if (files.length === 0 || !(await leave())) return
  uploading.value = true
  failure.value = undefined
  try {
    for (const file of files) {
      const uploaded = await media.upload(file)
      // Text typed into an earlier upload of this batch keeps its details open.
      if (!details.value?.dirty) selected.value = uploaded
    }
  } catch (error) {
    failure.value = failureMessage(error, t('media.errors.failed'))
  } finally {
    uploading.value = false
    table.value?.refresh()
  }
}

async function select(item: MediaItem) {
  if (item.id !== selected.value?.id && (await leave())) selected.value = item
}

function changed(item: MediaItem) {
  selected.value = item
  table.value?.refresh()
}
</script>

<template>
  <section>
    <PageHeader :title="t('media.library.title')" :description="t('media.library.description')">
      <template v-if="media.can('media.upload')" #actions>
        <UButton
          icon="i-lucide-upload"
          :label="t('media.library.upload')"
          :loading="uploading"
          @click="fileInput?.click()"
        />
        <input
          ref="fileInput"
          type="file"
          multiple
          class="sr-only"
          tabindex="-1"
          :aria-label="t('media.library.upload')"
          :accept="accept()"
          @change="upload"
        />
      </template>
    </PageHeader>
    <CachePurgeNotice
      v-if="!selected && (media.can('media.upload') || media.can('media.archive'))"
      :pending="uploading"
      class="mb-4"
    />
    <p v-if="failure" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
    <DataTable
      ref="table"
      :columns="columns"
      :load="load"
      :filters="filters"
      :caption="t('media.library.caption')"
      :empty-title="t('media.library.empty')"
      searchable
      :on-row-click="select"
    >
      <template #preview-cell="{ row }">
        <img
          v-if="row.original.mime !== 'application/pdf'"
          :src="row.original.url"
          alt=""
          loading="lazy"
          class="size-12 rounded bg-elevated object-cover"
        />
        <UIcon v-else name="i-lucide-file-text" class="size-8 text-muted" />
      </template>
    </DataTable>

    <USlideover
      v-model:open="open"
      :dismissible="dismissible"
      :title="t('media.details.title')"
      @close:prevent="close"
    >
      <template #body>
        <MediaDetails v-if="selected" ref="details" :item="selected" @changed="changed" />
      </template>
    </USlideover>
  </section>
</template>
