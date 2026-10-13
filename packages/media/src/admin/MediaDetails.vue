<script setup lang="ts">
/** One media item: preview, alt text and caption per content locale, replace, archive. */
import { CachePurgeNotice, useI18n } from '@opulonjs/admin'
import { UBadge, UButton } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import FieldText from '@opulonjs/ui/components/Field/Text'
import FieldTextarea from '@opulonjs/ui/components/Field/Textarea'
import LocaleTabs from '@opulonjs/ui/components/LocaleTabs'
import { reactive, ref, watch } from 'vue'
import type { MediaItem } from '../api.ts'
import { accept, failureMessage, formatSize, useMedia } from './use-media.ts'

const props = defineProps<{ item: MediaItem }>()
const emit = defineEmits<{ changed: [item: MediaItem] }>()

const { t, locale } = useI18n()
const media = useMedia()
const text = reactive<{
  alt: Record<string, string | null>
  caption: Record<string, string | null>
}>({
  alt: {},
  caption: {},
})
watch(
  () => props.item,
  (item) => {
    text.alt = { ...item.alt }
    text.caption = { ...item.caption }
  },
  { immediate: true },
)

const pending = ref(false)
const status = ref<{ kind: 'ok' | 'error'; message: string }>()
const confirming = ref(false)
const fileInput = ref<HTMLInputElement>()

async function run(action: () => Promise<MediaItem>, done: string) {
  pending.value = true
  status.value = undefined
  try {
    emit('changed', await action())
    status.value = { kind: 'ok', message: done }
  } catch (error) {
    status.value = { kind: 'error', message: failureMessage(error, t('media.errors.failed')) }
  } finally {
    pending.value = false
    confirming.value = false
  }
}

// A cleared field is null (or empty); the server drops empty locales.
const filled = (values: Record<string, string | null>) =>
  Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== null),
  )
const save = () =>
  run(
    () => media.update(props.item.id, { alt: filled(text.alt), caption: filled(text.caption) }),
    t('media.details.saved'),
  )
function replace(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) run(() => media.replace(props.item.id, file), t('media.details.replaced'))
}
const archive = () => run(() => media.archive(props.item.id), t('media.details.archived'))
const restore = () => run(() => media.restore(props.item.id), t('media.details.restored'))
</script>

<template>
  <div class="space-y-6">
    <CachePurgeNotice
      v-if="media.can('media.upload') || media.can('media.archive')"
      :pending="pending"
    />
    <figure class="space-y-2">
      <img
        v-if="item.mime !== 'application/pdf'"
        :src="item.url"
        :alt="item.alt[media.contentLocales.value[0] ?? ''] ?? ''"
        class="max-h-64 w-full rounded-md bg-elevated object-contain"
      />
      <figcaption class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span class="font-medium text-highlighted">{{ item.filename }}</span>
        <span>{{ formatSize(item.size, locale) }}</span>
        <span v-if="item.width !== null">{{ item.width }} × {{ item.height }} px</span>
        <UBadge v-if="item.archivedAt" color="neutral" variant="subtle">
          {{ t('media.details.archivedBadge') }}
        </UBadge>
        <a :href="item.url" target="_blank" rel="noopener" class="text-primary underline">
          {{ t('media.details.open') }}
        </a>
      </figcaption>
    </figure>

    <form class="space-y-4" @submit.prevent="save">
      <LocaleTabs :locales="media.contentLocales.value">
        <template v-for="code in media.contentLocales.value" :key="code" #[code]>
          <FieldText
            v-model="text.alt[code]"
            :name="`alt.${code}`"
            :label="t('media.details.alt')"
            :help="t('media.details.altHelp')"
            :disabled="!media.can('media.upload')"
            :maxlength="2000"
          />
          <FieldTextarea
            v-model="text.caption[code]"
            :name="`caption.${code}`"
            :label="t('media.details.caption')"
            :disabled="!media.can('media.upload')"
            :rows="2"
          />
        </template>
      </LocaleTabs>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="media.can('media.upload')"
          type="submit"
          :label="t('media.details.save')"
          :loading="pending"
        />
        <UButton
          v-if="media.can('media.upload')"
          color="neutral"
          variant="outline"
          icon="i-lucide-replace"
          :label="t('media.details.replace')"
          :disabled="pending"
          @click="fileInput?.click()"
        />
        <UButton
          v-if="media.can('media.archive') && !item.archivedAt"
          color="error"
          variant="ghost"
          icon="i-lucide-archive"
          :label="t('media.details.archive')"
          :disabled="pending"
          @click="confirming = true"
        />
        <UButton
          v-if="media.can('media.archive') && item.archivedAt"
          color="neutral"
          variant="ghost"
          icon="i-lucide-archive-restore"
          :label="t('media.details.restore')"
          :loading="pending"
          @click="restore"
        />
      </div>
      <input
        ref="fileInput"
        type="file"
        class="sr-only"
        tabindex="-1"
        :aria-label="t('media.details.replace')"
        :accept="accept(item.mime === 'application/pdf' ? 'pdf' : 'image')"
        @change="replace"
      />
      <p
        v-if="status"
        :role="status.kind === 'error' ? 'alert' : 'status'"
        :class="status.kind === 'error' ? 'text-error' : 'text-success'"
        class="text-sm"
      >
        {{ status.message }}
      </p>
    </form>

    <ConfirmDialog
      v-model:open="confirming"
      :title="t('media.details.archiveTitle')"
      :description="t('media.details.archiveWarning')"
      :confirm-label="t('media.details.archive')"
      :loading="pending"
      danger
      @confirm="archive"
    />
  </div>
</template>
