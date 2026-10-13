<script setup lang="ts">
/** Content > Site settings: global SEO and the host's fields, with draft and publishing. */
import { useI18n } from '@opulonjs/admin'
import { UCard } from '@opulonjs/ui'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { SiteSettings } from '../api.ts'
import RevisionHistory from './RevisionHistory.vue'
import FieldsForm from './FieldsForm.vue'
import PublishActions from './PublishActions.vue'
import { useAction, useCmsContext, useContent } from './use-cms.ts'

const { t } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const { pending, status, run } = useAction(() => t('cms.errors.failed'))

const settings = shallowRef<SiteSettings>()
const data = ref<Record<string, unknown>>({})
const revisionPending = ref(false)
const canEdit = computed(() => content.can('cms.site.edit'))

const show = (next: SiteSettings | undefined) => {
  if (!next) return
  settings.value = next
  data.value = structuredClone(next.draft.data)
}
onMounted(async () => show(await run(() => content.getSettings(), '')))

const save = async () =>
  show(await run(() => content.saveSettings({ data: data.value }), t('cms.page.saved')))
const publish = async () =>
  show(
    await run(async () => {
      await content.saveSettings({ data: data.value })
      return content.publishSettings()
    }, t('cms.page.published')),
  )
const unpublish = async () =>
  show(await run(() => content.unpublishSettings(), t('cms.site.unpublished')))
async function restored() {
  show(await run(() => content.getSettings(), t('cms.revisions.restored')))
}
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
          @save="save"
          @publish="publish"
          @unpublish="unpublish"
        />
      </template>
    </PageHeader>
    <p
      v-if="status && status.message"
      :role="status.kind === 'error' ? 'alert' : 'status'"
      :class="status.kind === 'error' ? 'text-error' : 'text-success'"
      class="mb-4 text-sm"
    >
      {{ status.message }}
    </p>
    <form v-if="settings" @submit.prevent="save">
      <UCard>
        <FieldsForm
          v-model:data="data"
          :group="definitions.settings"
          :locales="content.contentLocales.value"
          name="data"
          :disabled="!canEdit"
        />
      </UCard>
    </form>
    <RevisionHistory
      v-if="settings"
      kind="settings"
      :document-ref="'site'"
      :published-revision-id="settings.publishedRevisionId"
      :can-restore="content.can('cms.site.publish')"
      :disabled="pending"
      @busy="revisionPending = $event"
      @restored="restored"
    />
  </section>
</template>
