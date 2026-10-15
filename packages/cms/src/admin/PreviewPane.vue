<script setup lang="ts">
/**
 * The page editor's live preview: the host site's page in a frame, sent the unsaved draft as
 * the site renders it. A click in the frame comes back as `select`.
 */
import { useI18n } from '@opulonjs/admin'
import { languageName, UButton } from '@opulonjs/ui'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import { computed, onScopeDispose, ref, useId, useTemplateRef, watch } from 'vue'
import type { Page, PageDocument } from '../api.ts'
import type { CmsPreviewOptions } from './context.ts'
import { pagePreview } from '../localize.ts'
import { type AdminMessage, httpUrl, parseFrameMessage } from '../site/live-preview.ts'
import { useCmsContext, usePages } from './use-cms.ts'

const props = defineProps<{ page: Page; draft: PageDocument; url: CmsPreviewOptions['url'] }>()
const emit = defineEmits<{ select: [sectionId: string, field: string | undefined] }>()

const { t, locale: adminLocale } = useI18n()
const { definitions } = useCmsContext()
const locales = usePages().contentLocales
const heading = useId()
const picked = ref<string | number | null>(locales.value[0] ?? null)
const locale = computed(() => (typeof picked.value === 'string' ? picked.value : ''))
const width = ref<'desktop' | 'mobile'>('desktop')
const frame = useTemplateRef<HTMLIFrameElement>('frame')

const localeItems = computed(() =>
  locales.value.map((code) => ({ value: code, label: languageName(code, adminLocale.value) })),
)
const target = computed(() => {
  const { id, draft } = props.page
  const path = draft.locales[locale.value]?.path ?? ''
  return httpUrl(props.url({ id, locale: locale.value, path }), location.href)
})
const src = computed(() => target.value?.href)
let ready = false
watch(src, () => (ready = false))

let timer: ReturnType<typeof setTimeout> | undefined
const send = () => {
  clearTimeout(timer)
  const frameWindow = frame.value?.contentWindow
  if (!ready || !frameWindow || !target.value) return
  const message = {
    type: 'opulon:cms:preview',
    preview: pagePreview(
      definitions,
      locales.value,
      { id: props.page.id, draft: props.draft },
      locale.value,
    ),
  } satisfies AdminMessage
  // A plain copy: the draft is a Vue proxy, which postMessage cannot clone.
  const plain: unknown = JSON.parse(JSON.stringify(message))
  frameWindow.postMessage(plain, target.value.origin)
}
const schedule = () => {
  clearTimeout(timer)
  timer = setTimeout(send, 150)
}
watch(() => props.draft, schedule, { deep: true })

const onMessage = (event: MessageEvent) => {
  const frameWindow = frame.value?.contentWindow
  if (!target.value || !frameWindow) return
  if (event.origin !== target.value.origin || event.source !== frameWindow) return
  const message = parseFrameMessage(event.data)
  if (message?.type === 'opulon:cms:ready') {
    ready = true
    send()
  } else if (message) {
    const section = props.draft.sections.find((s) => s.id === message.sectionId)
    if (!section) return
    const fields = definitions.sections[section.type]?.fields ?? {}
    const field = message.field
    emit(
      'select',
      section.id,
      field !== undefined && Object.hasOwn(fields, field) ? field : undefined,
    )
  }
}
window.addEventListener('message', onMessage)
onScopeDispose(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(timer)
})
</script>

<template>
  <section :aria-labelledby="heading" class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h2 :id="heading" class="font-semibold text-highlighted">{{ t('cms.page.preview') }}</h2>
      <div class="flex flex-wrap items-end gap-2">
        <FieldSelect
          v-model="picked"
          name="previewLocale"
          :label="t('cms.page.previewLocale')"
          :items="localeItems"
          class="min-w-40"
        />
        <UButton
          :label="t('cms.page.desktop')"
          icon="i-lucide-monitor"
          color="neutral"
          :variant="width === 'desktop' ? 'soft' : 'ghost'"
          :aria-pressed="width === 'desktop'"
          @click="width = 'desktop'"
        />
        <UButton
          :label="t('cms.page.mobile')"
          icon="i-lucide-smartphone"
          color="neutral"
          :variant="width === 'mobile' ? 'soft' : 'ghost'"
          :aria-pressed="width === 'mobile'"
          @click="width = 'mobile'"
        />
      </div>
    </div>
    <p v-if="!src" class="text-sm text-error">{{ t('cms.page.previewUnavailable') }}</p>
    <iframe
      v-else
      ref="frame"
      :key="src"
      :src="src"
      :title="t('cms.page.previewTitle')"
      class="block h-[70vh] rounded-md border border-default bg-white"
      :class="width === 'mobile' ? 'mx-auto w-[390px] max-w-full' : 'w-full'"
    />
  </section>
</template>
