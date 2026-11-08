<script setup lang="ts">
/** Content > Site settings: global SEO and the host's fields, with draft and publishing. */
import { CachePurgeNotice, useI18n } from '@opulonjs/admin'
import { UCard } from '@opulonjs/ui'
import LocaleSwitch from '@opulonjs/ui/components/LocaleSwitch'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import type { SiteSettings } from '../api.ts'
import RevisionHistory from './RevisionHistory.vue'
import FieldsForm from './FieldsForm.vue'
import PublishActions from './PublishActions.vue'
import ActionStatus from './ActionStatus.vue'
import {
  useAction,
  useCmsContext,
  useContent,
  useContentLocale,
  useDraftChanges,
  useFocusReturn,
} from './use-cms.ts'

const { t } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const { pending, status, run } = useAction(() => t('cms.errors.failed'))

const settings = shallowRef<SiteSettings>()
const data = ref<Record<string, unknown>>({})
const baseline = shallowRef<Record<string, unknown>>()
const revisionPending = ref(false)
const canEdit = computed(() => content.can('cms.site.edit'))
const locked = computed(() => !canEdit.value || pending.value || revisionPending.value)
const locales = computed(() => content.contentLocales.value)
const contentLocale = useContentLocale(() => locales.value, status)
const form = useTemplateRef<HTMLFormElement>('form')
useFocusReturn(
  () => pending.value || revisionPending.value,
  () => form.value,
)

const show = (next: SiteSettings) => {
  settings.value = next
  data.value = structuredClone(next.draft.data)
  baseline.value = structuredClone(next.draft.data)
}
onMounted(() => run(() => content.getSettings(), '', show))

const saveDraft = () => content.saveSettings(settings.value!.version, { data: data.value })
const save = () => run(saveDraft, t('cms.page.saved'), show)
const publish = () =>
  run(
    async (current) => {
      const saved = await saveDraft()
      if (!current()) return
      settings.value = saved
      baseline.value = structuredClone(saved.draft.data)
      return content.publishSettings(saved.version)
    },
    t('cms.page.published'),
    show,
  )
const unpublish = () =>
  run(
    () => content.unpublishSettings(),
    t('cms.site.unpublished'),
    (next) => (settings.value = next),
  )
const reload = (done = '') => run(() => content.getSettings(), done, show)
useDraftChanges({
  draft: data,
  baseline,
  save,
  busy: () => pending.value || revisionPending.value,
})
</script>

<template>
  <section>
    <PageHeader :title="t('cms.settings.title')" :description="t('cms.settings.description')">
      <template v-if="settings" #actions>
        <PublishActions
          :status="settings.status"
          :published="settings.published !== null"
          :pending="pending || revisionPending"
          :can-edit="canEdit"
          :can-publish="content.can('cms.site.publish')"
          @publish="publish"
          @unpublish="unpublish"
        />
      </template>
    </PageHeader>
    <CachePurgeNotice :pending="pending || revisionPending" class="mb-4" />
    <ActionStatus :status="status" @reload="reload()" />
    <LocaleSwitch v-if="settings" v-model="contentLocale" :locales="locales" class="mb-4" />
    <form
      v-if="settings"
      ref="form"
      tabindex="-1"
      :aria-label="t('cms.settings.title')"
      @submit.prevent="save"
    >
      <fieldset :disabled="pending || revisionPending" class="min-w-0">
        <UCard>
          <FieldsForm
            v-model:data="data"
            :group="definitions.settings"
            :locales="locales"
            :locale="contentLocale"
            name="data"
            :disabled="locked"
          />
        </UCard>
      </fieldset>
    </form>
    <RevisionHistory
      v-if="settings"
      v-model:content-locale="contentLocale"
      :version="settings.version"
      kind="settings"
      :document-ref="'site'"
      :published-revision-id="settings.publishedRevisionId"
      :can-restore="content.can('cms.site.publish')"
      :disabled="pending"
      @busy="revisionPending = $event"
      @restored="reload(t('cms.revisions.restored'))"
      @reload="reload()"
    />
  </section>
</template>
