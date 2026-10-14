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
import ActionStatus from './ActionStatus.vue'
import { useAction, useCmsContext, useContent, useFocusReturn } from './use-cms.ts'

const { t } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const { pending, status, run } = useAction(() => t('cms.errors.failed'))

const settings = shallowRef<SiteSettings>()
const data = ref<Record<string, unknown>>({})
const revisionPending = ref(false)
const canEdit = computed(() => content.can('cms.site.edit'))
const locked = computed(() => !canEdit.value || pending.value || revisionPending.value)
useFocusReturn(() => pending.value || revisionPending.value)

const show = (next: SiteSettings | undefined) => {
  if (!next) return
  settings.value = next
  data.value = structuredClone(next.draft.data)
}
onMounted(async () => show(await run(() => content.getSettings(), '')))

const saveDraft = () => content.saveSettings(settings.value!.version, { data: data.value })
const save = async () => show(await run(saveDraft, t('cms.page.saved')))
async function publish() {
  const saved = await run(saveDraft, '')
  if (!saved) return
  settings.value = saved
  show(await run(() => content.publishSettings(saved.version), t('cms.page.published')))
}
const unpublish = async () =>
  show(await run(() => content.unpublishSettings(), t('cms.site.unpublished')))
const reload = async (done = '') => show(await run(() => content.getSettings(), done))
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
    <ActionStatus :status="status" @reload="reload()" />
    <form v-if="settings" @submit.prevent="save">
      <fieldset :disabled="pending || revisionPending" class="min-w-0">
        <UCard>
          <FieldsForm
            v-model:data="data"
            :group="definitions.settings"
            :locales="content.contentLocales.value"
            name="data"
            :disabled="locked"
          />
        </UCard>
      </fieldset>
    </form>
    <RevisionHistory
      v-if="settings"
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
