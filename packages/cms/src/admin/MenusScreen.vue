<script setup lang="ts">
/** Content > Menus: the host's menus as tabs; the chosen one's entries, draft and publishing. */
import { useI18n } from '@opulonjs/admin'
import { UButton, UCard } from '@opulonjs/ui'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { labelText, type Menu, type MenuDocument } from '../api.ts'
import MenuItemsEditor, { type EditedMenuItem } from './MenuItemsEditor.vue'
import PublishActions from './PublishActions.vue'
import { useAction, useCmsContext, useContent } from './use-cms.ts'

const { t, locale } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const route = useRoute()
const { pending, status, run } = useAction(() => t('cms.errors.failed'))

const keys = Object.keys(definitions.menus)
const current = computed(() => {
  const wanted = String(route.params.key ?? '')
  return keys.includes(wanted) ? wanted : keys[0]
})
const menu = shallowRef<Menu>()
const items = ref<EditedMenuItem[]>([])
const canEdit = computed(() => content.can('cms.site.edit'))

const show = (next: Menu | undefined) => {
  if (!next) return
  menu.value = next
  items.value = structuredClone(next.draft.items) as EditedMenuItem[]
}
watch(
  current,
  async (key) => {
    menu.value = undefined
    status.value = undefined
    if (key) show(await run(() => content.getMenu(key), ''))
  },
  { immediate: true },
)

// The server validates links; the editor's working copy is sent as is.
const document = () => ({ items: items.value }) as unknown as MenuDocument
const save = async () =>
  show(await run(() => content.saveMenu(current.value!, document()), t('cms.page.saved')))
const publish = async () =>
  show(
    await run(async () => {
      await content.saveMenu(current.value!, document())
      return content.publishMenu(current.value!)
    }, t('cms.page.published')),
  )
const unpublish = async () =>
  show(await run(() => content.unpublishMenu(current.value!), t('cms.site.unpublished')))
</script>

<template>
  <section>
    <PageHeader :title="t('cms.menus.title')" :description="t('cms.menus.description')">
      <template v-if="menu" #actions>
        <PublishActions
          :status="menu.status"
          :published="menu.published !== null"
          :pending="pending"
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
    <p
      v-if="status && status.message"
      :role="status.kind === 'error' ? 'alert' : 'status'"
      :class="status.kind === 'error' ? 'text-error' : 'text-success'"
      class="mb-4 text-sm"
    >
      {{ status.message }}
    </p>
    <form v-if="menu && current" @submit.prevent="save">
      <UCard>
        <p v-if="items.length === 0" class="mb-3 text-sm text-muted">{{ t('cms.menus.empty') }}</p>
        <MenuItemsEditor
          v-model:items="items"
          :level="1"
          :depth="definitions.menus[current]!.depth ?? 3"
          :locales="content.contentLocales.value"
          name="items"
          :disabled="!canEdit"
        />
      </UCard>
    </form>
  </section>
</template>
