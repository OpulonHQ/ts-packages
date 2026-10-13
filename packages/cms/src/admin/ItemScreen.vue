<script setup lang="ts">
/**
 * One collection item: path, availability and SEO per content locale (routed collections
 * only), the collection's fields, and save draft / publish / unpublish / delete.
 */
import { useI18n } from '@opulonjs/admin'
import { UCard } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { type Item, type ItemDocument, labelText, type PageLocale } from '../api.ts'
import FieldsForm from './FieldsForm.vue'
import LocaleDetails from './LocaleDetails.vue'
import PublishActions from './PublishActions.vue'
import { useAction, useCmsContext, useContent } from './use-cms.ts'

interface Draft {
  locales: Record<string, PageLocale>
  data: Record<string, unknown>
}

const { t, locale } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const route = useRoute()
const router = useRouter()
const { pending, status, run } = useAction(() => t('cms.errors.failed'))

const item = shallowRef<Item>()
const draft = ref<Draft>()
const missing = ref(false)
const confirming = ref(false)

const locales = computed(() => content.contentLocales.value)
const canEdit = computed(() => content.can('cms.collections.edit'))
const collection = computed(() =>
  item.value ? definitions.collections[item.value.collection] : undefined,
)
const collectionLabel = computed(() => labelText(collection.value?.label, locale.value))

const toDraft = (document: ItemDocument): Draft => {
  // A deep, mutable copy: JSON documents only.
  const copy = structuredClone(document) as Draft
  for (const code of locales.value)
    copy.locales[code] ??= {
      path: '',
      available: false,
      seo: { title: '', description: '', image: null, noindex: false },
    }
  return copy
}
const show = (next: Item | undefined) => {
  if (!next) return
  item.value = next
  draft.value = toDraft(next.draft)
}

watch(
  () => String(route.params.id),
  async (id) => {
    missing.value = false
    try {
      show(await content.getItem(id))
    } catch {
      missing.value = true
    }
  },
  { immediate: true },
)

const save = async () =>
  show(await run(() => content.saveItem(item.value!.id, draft.value!), t('cms.page.saved')))
// Publishing publishes what is on screen: the draft is saved first.
const publish = async () =>
  show(
    await run(async () => {
      await content.saveItem(item.value!.id, draft.value!)
      return content.publishItem(item.value!.id)
    }, t('cms.page.published')),
  )
const unpublish = async () =>
  show(await run(() => content.unpublishItem(item.value!.id), t('cms.item.unpublished')))
async function remove() {
  confirming.value = false
  const collectionKey = item.value!.collection
  await run(() => content.removeItem(item.value!.id), '')
  if (status.value?.kind === 'ok')
    await router.push({ name: 'cms.collections', params: { collection: collectionKey } })
}
</script>

<template>
  <section>
    <p v-if="missing" role="alert" class="text-sm text-error">{{ t('cms.errors.notFound') }}</p>
    <template v-else-if="item && draft && collection">
      <PageHeader
        :title="item.title"
        :breadcrumbs="[
          {
            label: collectionLabel,
            to: { name: 'cms.collections', params: { collection: item.collection } },
          },
          { label: item.title },
        ]"
      >
        <template #actions>
          <PublishActions
            :status="item.status"
            :published="item.published !== null"
            :pending="pending"
            :can-edit="canEdit"
            :can-publish="content.can('cms.collections.publish')"
            deletable
            @save="save"
            @publish="publish"
            @unpublish="unpublish"
            @delete="confirming = true"
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

      <form class="space-y-6" @submit.prevent="save">
        <UCard v-if="collection.routed">
          <template #header>
            <h2 class="font-semibold text-highlighted">{{ t('cms.item.details') }}</h2>
          </template>
          <LocaleDetails :value="draft.locales" :locales="locales" :disabled="!canEdit" />
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">{{ t('cms.item.content') }}</h2>
          </template>
          <FieldsForm
            v-model:data="draft.data"
            :group="collection"
            :locales="locales"
            name="data"
            :disabled="!canEdit"
          />
        </UCard>
      </form>

      <ConfirmDialog
        v-model:open="confirming"
        :title="t('cms.item.deleteTitle')"
        :description="t('cms.item.deleteWarning')"
        :confirm-label="t('cms.page.delete')"
        :loading="pending"
        danger
        @confirm="remove"
      />
    </template>
  </section>
</template>
