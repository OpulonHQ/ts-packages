<script setup lang="ts">
/**
 * One page: path, availability and SEO per content locale, its ordered sections with forms
 * generated from the definitions, and save draft / publish / unpublish / delete.
 */
import { useI18n } from '@opulonjs/admin'
import { UButton, UCard } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StalePurgeNotice from './StalePurgeNotice.vue'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { labelText, type Page, type PageDocument, type PageLocale } from '../api.ts'
import FieldsForm from './FieldsForm.vue'
import LocaleDetails from './LocaleDetails.vue'
import { failureMessage, pageTitle, useCmsContext, usePages } from './use-cms.ts'

/** The draft as edited: plain mutable copies of the document's parts. */
interface Draft {
  locales: Record<string, PageLocale>
  sections: Array<{ id: string; type: string; data: Record<string, unknown> }>
}

const { t, locale } = useI18n()
const pages = usePages()
const { definitions } = useCmsContext()
const route = useRoute()
const router = useRouter()

const page = shallowRef<Page>()
const draft = ref<Draft>()
const missing = ref(false)
const pending = ref(false)
const confirming = ref(false)
const status = ref<{ kind: 'ok' | 'error'; message: string }>()
const newType = ref<string | number | null>(null)

const locales = computed(() => pages.contentLocales.value)
const canEdit = computed(() => pages.can('cms.pages.edit'))
const title = computed(() => (page.value ? pageTitle(definitions, page.value, locale.value) : ''))
const typeLabel = (type: string) => labelText(definitions.sections[type]?.label, locale.value)
const typeItems = computed(() =>
  Object.keys(definitions.sections).map((key) => ({ value: key, label: typeLabel(key) })),
)

const blankLocale = (): PageLocale => ({
  path: '',
  available: false,
  seo: { title: '', description: '', image: null, noindex: false },
})
const toDraft = (document: PageDocument): Draft => {
  // A deep, mutable copy: JSON documents only.
  const copy = structuredClone(document) as Draft
  for (const code of locales.value) copy.locales[code] ??= blankLocale()
  return copy
}
const show = (next: Page) => {
  page.value = next
  draft.value = toDraft(next.draft)
}

watch(
  () => String(route.params.id),
  async (id) => {
    missing.value = false
    try {
      show(await pages.get(id))
    } catch {
      missing.value = true
    }
  },
  { immediate: true },
)

async function run(action: () => Promise<Page | void>, done: string) {
  pending.value = true
  status.value = undefined
  try {
    const next = await action()
    if (next) show(next)
    status.value = { kind: 'ok', message: done }
  } catch (error) {
    status.value = { kind: 'error', message: failureMessage(error, t('cms.errors.failed')) }
  } finally {
    pending.value = false
  }
}

const save = () => run(() => pages.save(page.value!.id, draft.value!), t('cms.page.saved'))
// Publishing publishes what is on screen: the draft is saved first.
const publish = () =>
  run(async () => {
    await pages.save(page.value!.id, draft.value!)
    return pages.publish(page.value!.id)
  }, t('cms.page.published'))
const unpublish = () => run(() => pages.unpublish(page.value!.id), t('cms.page.unpublished'))
async function remove() {
  confirming.value = false
  await run(() => pages.remove(page.value!.id), '')
  if (status.value?.kind === 'ok') await router.push({ name: 'cms.pages' })
}

function addSection() {
  if (!newType.value || !draft.value) return
  draft.value.sections.push({ id: crypto.randomUUID(), type: String(newType.value), data: {} })
  newType.value = null
}
function move(index: number, by: -1 | 1) {
  const sections = draft.value!.sections
  const [section] = sections.splice(index, 1)
  sections.splice(index + by, 0, section!)
}
</script>

<template>
  <section>
    <p v-if="missing" role="alert" class="text-sm text-error">{{ t('cms.errors.notFound') }}</p>
    <template v-else-if="page && draft">
      <PageHeader
        :title="title"
        :breadcrumbs="[{ label: t('cms.page.back'), to: { name: 'cms.pages' } }, { label: title }]"
      >
        <template #actions>
          <StatusBadge
            :status="page.status"
            :label="t(`cms.status.${page.status}`)"
            :color="page.status === 'changed' ? 'warning' : undefined"
          />
          <UButton
            v-if="canEdit"
            :label="t('cms.page.save')"
            color="neutral"
            variant="outline"
            :loading="pending"
            @click="save"
          />
          <UButton
            v-if="canEdit && pages.can('cms.pages.publish')"
            :label="t('cms.page.publish')"
            icon="i-lucide-globe"
            :loading="pending"
            @click="publish"
          />
          <UButton
            v-if="pages.can('cms.pages.publish') && page.published"
            :label="t('cms.page.unpublish')"
            color="neutral"
            variant="ghost"
            :disabled="pending"
            @click="unpublish"
          />
          <UButton
            v-if="canEdit && !page.systemKey"
            :label="t('cms.page.delete')"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :disabled="pending"
            @click="confirming = true"
          />
        </template>
      </PageHeader>
      <StalePurgeNotice :pending="pending" class="mb-4" />

      <p
        v-if="status && status.message"
        :role="status.kind === 'error' ? 'alert' : 'status'"
        :class="status.kind === 'error' ? 'text-error' : 'text-success'"
        class="mb-4 text-sm"
      >
        {{ status.message }}
      </p>

      <form class="space-y-6" @submit.prevent="save">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">{{ t('cms.page.details') }}</h2>
          </template>
          <LocaleDetails :value="draft.locales" :locales="locales" :disabled="!canEdit" />
        </UCard>

        <div class="space-y-4">
          <h2 class="font-semibold text-highlighted">{{ t('cms.page.sections') }}</h2>
          <p v-if="draft.sections.length === 0" class="text-sm text-muted">
            {{ t('cms.page.noSections') }}
          </p>
          <UCard v-for="(section, index) in draft.sections" :key="section.id">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <h3 class="font-medium text-highlighted">
                  {{ index + 1 }}. {{ typeLabel(section.type) }}
                </h3>
                <div v-if="canEdit" class="flex gap-1">
                  <UButton
                    icon="i-lucide-arrow-up"
                    color="neutral"
                    variant="ghost"
                    :aria-label="t('cms.page.moveUp')"
                    :disabled="index === 0"
                    @click="move(index, -1)"
                  />
                  <UButton
                    icon="i-lucide-arrow-down"
                    color="neutral"
                    variant="ghost"
                    :aria-label="t('cms.page.moveDown')"
                    :disabled="index === draft.sections.length - 1"
                    @click="move(index, 1)"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="error"
                    variant="ghost"
                    :aria-label="t('cms.page.removeSection')"
                    @click="draft.sections.splice(index, 1)"
                  />
                </div>
              </div>
            </template>
            <FieldsForm
              v-if="definitions.sections[section.type]"
              v-model:data="section.data"
              :group="definitions.sections[section.type]!"
              :locales="locales"
              :name="`sections.${index}`"
              :disabled="!canEdit"
            />
          </UCard>
          <div v-if="canEdit" class="flex items-end gap-2">
            <FieldSelect
              v-model="newType"
              name="newSection"
              :label="t('cms.page.sectionType')"
              :items="typeItems"
              class="min-w-60"
            />
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              :label="t('cms.page.addSection')"
              :disabled="!newType"
              @click="addSection"
            />
          </div>
        </div>
      </form>

      <ConfirmDialog
        v-model:open="confirming"
        :title="t('cms.page.deleteTitle')"
        :description="t('cms.page.deleteWarning')"
        :confirm-label="t('cms.page.delete')"
        :loading="pending"
        danger
        @confirm="remove"
      />
    </template>
  </section>
</template>
