<script setup lang="ts">
/** Content > Menus > one menu (a sidebar entry each): its entries, draft and publishing. */
import { CachePurgeNotice, useI18n, useNavTarget } from '@opulonjs/admin'
import { UCard } from '@opulonjs/ui'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { Schema } from 'effect'
import { computed, ref, shallowRef, watch, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import { labelText, type Menu, MenuDocument } from '../api.ts'
import RevisionHistory from './RevisionHistory.vue'
import MenuItemsEditor, { type EditedMenuItem } from './MenuItemsEditor.vue'
import PublishActions from './PublishActions.vue'
import ActionStatus from './ActionStatus.vue'
import { useAction, useCmsContext, useContent, useDraftChanges, useFocusReturn } from './use-cms.ts'

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
// `/cms/menus` without a key shows the first menu: highlight its entry.
useNavTarget(() =>
  current.value === undefined ? undefined : { route: 'cms.menus', params: { key: current.value } },
)
const menu = shallowRef<Menu>()
const items = ref<EditedMenuItem[]>([])
// The entries as last saved, the unsaved-changes bar's comparison and Discard's copy.
const baseline = shallowRef<EditedMenuItem[]>()
const revisionPending = ref(false)
const canEdit = computed(() => content.can('cms.site.edit'))
const locked = computed(() => !canEdit.value || pending.value || revisionPending.value)
const form = useTemplateRef<HTMLFormElement>('form')
useFocusReturn(
  () => pending.value || revisionPending.value,
  () => form.value,
)

const editable = (next: Menu) =>
  next.draft.items.map(function copy(item): EditedMenuItem {
    return { ...item, label: { ...item.label }, children: item.children.map(copy) }
  })
const show = (next: Menu) => {
  menu.value = next
  items.value = editable(next)
  baseline.value = editable(next)
}
watch(
  current,
  async (key) => {
    invalidate()
    menu.value = undefined
    baseline.value = undefined
    items.value = []
    status.value = undefined
    if (key) await run(() => content.getMenu(key), '', show)
  },
  { immediate: true },
)

const document = () => Schema.decodeUnknownSync(MenuDocument)({ items: items.value })
// The server validates links; the editor's working copy is sent as is.
const saveDraft = () => content.saveMenu(current.value!, menu.value!.version, document())
const save = () => run(saveDraft, t('cms.page.saved'), show)
const publish = () =>
  run(
    async (current) => {
      const saved = await saveDraft()
      if (!current()) return
      menu.value = saved
      baseline.value = editable(saved)
      return content.publishMenu(saved.key, saved.version)
    },
    t('cms.page.published'),
    show,
  )
// Unpublishing leaves the draft as it was, so edits on screen stay on screen.
const unpublish = () =>
  run(
    () => content.unpublishMenu(current.value!),
    t('cms.site.unpublished'),
    (next) => (menu.value = next),
  )
const reload = (done = '') => run(() => content.getMenu(current.value!), done, show)
useDraftChanges({
  draft: items,
  baseline,
  save,
  busy: () => pending.value || revisionPending.value,
})
</script>

<template>
  <section>
    <PageHeader
      :title="current ? labelText(definitions.menus[current]!.label, locale) : t('cms.menus.title')"
      :description="t('cms.menus.description')"
    >
      <template v-if="menu" #actions>
        <PublishActions
          :status="menu.status"
          :published="menu.published !== null"
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
    <form
      v-if="menu && current"
      ref="form"
      tabindex="-1"
      :aria-label="labelText(definitions.menus[current]!.label, locale)"
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
