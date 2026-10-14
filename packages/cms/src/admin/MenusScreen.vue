<script setup lang="ts">
/** Content > Menus: the host's menus as tabs; the chosen one's entries, draft and publishing. */
import { useI18n } from '@opulonjs/admin'
import { UButton, UCard } from '@opulonjs/ui'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { Schema } from 'effect'
import { computed, ref, shallowRef, watch, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import { labelText, type Menu, MenuDocument } from '../api.ts'
import RevisionHistory from './RevisionHistory.vue'
import MenuItemsEditor, { type EditedMenuItem } from './MenuItemsEditor.vue'
import PublishActions from './PublishActions.vue'
import ActionStatus from './ActionStatus.vue'
import { useAction, useCmsContext, useContent, useFocusReturn } from './use-cms.ts'

const { t, locale } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const route = useRoute()
const { pending, status, run, invalidate } = useAction(() => t('cms.errors.failed'))

const keys = Object.keys(definitions.menus)
const current = computed(() => {
  const wanted = String(route.params.key ?? '')
  return keys.includes(wanted) ? wanted : keys[0]
})
const menu = shallowRef<Menu>()
const items = ref<EditedMenuItem[]>([])
const revisionPending = ref(false)
const canEdit = computed(() => content.can('cms.site.edit'))
const locked = computed(() => !canEdit.value || pending.value || revisionPending.value)
const form = useTemplateRef<HTMLFormElement>('form')
useFocusReturn(
  () => pending.value || revisionPending.value,
  () => form.value,
)

const show = (next: Menu | undefined) => {
  if (!next) return
  menu.value = next
  items.value = next.draft.items.map(function copy(item): EditedMenuItem {
    return { ...item, label: { ...item.label }, children: item.children.map(copy) }
  })
}
watch(
  current,
  async (key) => {
    invalidate()
    menu.value = undefined
    status.value = undefined
    if (key) show(await run(() => content.getMenu(key), ''))
  },
  { immediate: true },
)

const document = () => Schema.decodeUnknownSync(MenuDocument)({ items: items.value })
// The server validates links; the editor's working copy is sent as is.
const saveDraft = () => content.saveMenu(current.value!, menu.value!.version, document())
const save = async () => show(await run(saveDraft, t('cms.page.saved')))
async function publish() {
  const saved = await run(saveDraft, '')
  if (!saved) return
  menu.value = saved
  show(await run(() => content.publishMenu(saved.key, saved.version), t('cms.page.published')))
}
const unpublish = async () =>
  show(await run(() => content.unpublishMenu(current.value!), t('cms.site.unpublished')))
const reload = async (done = '') => show(await run(() => content.getMenu(current.value!), done))
</script>

<template>
  <section>
    <PageHeader :title="t('cms.menus.title')" :description="t('cms.menus.description')">
      <template v-if="menu" #actions>
        <PublishActions
          :status="menu.status"
          :published="menu.published !== null"
          :pending="pending || revisionPending"
          :can-edit="canEdit"
          :can-publish="content.can('cms.site.publish')"
          @save="save"
          @publish="publish"
          @unpublish="unpublish"
        />
      </template>
    </PageHeader>
    <nav class="mb-4 flex flex-wrap gap-2" :aria-label="t('cms.menus.title')">
      <UButton
        v-for="key in keys"
        :key="key"
        :to="{ name: 'cms.menus', params: { key } }"
        :label="labelText(definitions.menus[key]!.label, locale)"
        :variant="key === current ? 'solid' : 'outline'"
        color="neutral"
        :aria-current="key === current ? 'page' : undefined"
      />
    </nav>
    <ActionStatus :status="status" @reload="reload()" />
    <form
      v-if="menu && current"
      ref="form"
      tabindex="-1"
      :aria-label="t('cms.menus.title')"
      class="focus:outline-none"
      @submit.prevent="save"
    >
      <fieldset :disabled="pending || revisionPending" class="min-w-0">
        <UCard>
          <p v-if="items.length === 0" class="mb-3 text-sm text-muted">
            {{ t('cms.menus.empty') }}
          </p>
          <MenuItemsEditor
            v-model:items="items"
            :level="1"
            :depth="definitions.menus[current]!.depth ?? 3"
            :locales="content.contentLocales.value"
            name="items"
            :disabled="locked"
          />
        </UCard>
      </fieldset>
    </form>
    <RevisionHistory
      v-if="menu && current"
      :version="menu.version"
      kind="menu"
      :document-ref="current"
      :published-revision-id="menu.publishedRevisionId"
      :can-restore="content.can('cms.site.publish')"
      :disabled="pending"
      @busy="revisionPending = $event"
      @restored="reload(t('cms.revisions.restored'))"
      @reload="reload()"
    />
  </section>
</template>
