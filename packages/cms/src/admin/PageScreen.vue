<script setup lang="ts">
import { CachePurgeNotice, useI18n } from '@opulonjs/admin'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import LocaleSwitch from '@opulonjs/ui/components/LocaleSwitch'
import FieldToggle from '@opulonjs/ui/components/Field/Toggle'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, nextTick, ref, shallowRef, useId, watch, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { labelText, type Page, type PageDocument, type PageLocale } from '../api.ts'
import { emptyLocale } from '../localize.ts'
import RevisionHistory from './RevisionHistory.vue'
import FieldsForm from './FieldsForm.vue'
import LocaleAvailability from './LocaleAvailability.vue'
import LocaleDetails from './LocaleDetails.vue'
import PageOutline from './PageOutline.vue'
import PreviewPane from './PreviewPane.vue'
import PublishActions from './PublishActions.vue'
import ActionStatus from './ActionStatus.vue'
import {
  firstControl,
  type PageSelection,
  pageTitle,
  useAction,
  useCmsContext,
  useContentLocale,
  useDraftChanges,
  usePages,
  useFocusReturn,
} from './use-cms.ts'

/** The draft as edited: plain mutable copies of the document's parts. */
interface Draft {
  locales: Record<string, PageLocale>
  sections: Array<{ id: string; type: string; data: Record<string, unknown>; hidden?: boolean }>
}

const { t, locale } = useI18n()
const pages = usePages()
const { definitions, preview } = useCmsContext()
const route = useRoute()
const router = useRouter()
const { pending, status, run, invalidate } = useAction(() => t('cms.errors.failed'))

const page = shallowRef<Page>()
const draft = ref<Draft>()
const baseline = shallowRef<Draft>()
const missing = ref(false)
const confirming = ref(false)
const revisionPending = ref(false)
const chosen = ref<PageSelection>()
const inputsHeading = useId()
const panels = useId()

const locales = computed(() => pages.contentLocales.value)
const canEdit = computed(() => pages.can('cms.pages.edit'))
const locked = computed(() => !canEdit.value || pending.value || revisionPending.value)
const form = useTemplateRef<HTMLFormElement>('form')
const contentLocale = useContentLocale(() => locales.value, status)
useFocusReturn(
  () => pending.value || revisionPending.value,
  () => form.value,
)
const title = computed(() => (page.value ? pageTitle(definitions, page.value, locale.value) : ''))
const typeLabel = (type: string) => labelText(definitions.sections[type]?.label, locale.value)

const selection = computed({
  get: (): PageSelection => {
    const sections = draft.value?.sections ?? []
    const pick = chosen.value
    if (pick?.kind === 'page' || (pick && sections.some((s) => s.id === pick.id))) return pick
    return sections[0] ? { kind: 'section', id: sections[0].id } : { kind: 'page' }
  },
  set: (next: PageSelection) => (chosen.value = next),
})
const selectedIndex = computed(() => {
  const current = selection.value
  return current.kind === 'section'
    ? (draft.value?.sections.findIndex((s) => s.id === current.id) ?? -1)
    : -1
})

async function focusField(sectionId: string, field: string | undefined, locale: string) {
  const panel = document.getElementById(`${panels}-${sectionId}`)
  if (!panel) return
  selection.value = { kind: 'section', id: sectionId }
  contentLocale.value = locale
  await nextTick()
  const wrapper = [...panel.querySelectorAll<HTMLElement>('[data-field]')].find(
    (el) => el.dataset.field === field && !el.parentElement?.closest('[data-field]'),
  )
  const control = (wrapper && firstControl(wrapper)) ?? firstControl(panel) ?? panel
  control.focus()
}

const setHidden = (section: Draft['sections'][number], hidden: boolean) => {
  if (hidden) section.hidden = true
  else delete section.hidden
}

const toDraft = (document: PageDocument): Draft => {
  // A deep, mutable copy: JSON documents only.
  const copy: Draft = {
    locales: Object.fromEntries(
      Object.entries(document.locales).map(([code, value]) => [code, structuredClone(value)]),
    ),
    sections: document.sections.map((section) => ({
      ...section,
      data: structuredClone(section.data),
    })),
  }
  for (const code of locales.value) copy.locales[code] ??= emptyLocale()
  return copy
}
const show = (next: Page) => {
  page.value = next
  draft.value = toDraft(next.draft)
  baseline.value = toDraft(next.draft)
}

let loadTicket = 0
watch(
  () => String(route.params.id),
  async (id) => {
    const request = ++loadTicket
    invalidate()
    chosen.value = undefined
    page.value = undefined
    draft.value = undefined
    baseline.value = undefined
    missing.value = false
    try {
      const next = await pages.get(id)
      if (request === loadTicket) show(next)
    } catch {
      if (request === loadTicket) missing.value = true
    }
  },
  { immediate: true },
)

const saveDraft = () => pages.save(page.value!.id, page.value!.version, draft.value!)
const save = () => run(saveDraft, t('cms.page.saved'), show)

// Publishing publishes what is on screen: the draft is saved first, under the same lock.
const publish = () =>
  run(
    async (current) => {
      const saved = await saveDraft()
      if (!current()) return
      page.value = saved
      baseline.value = toDraft(saved.draft)
      return pages.publish(saved.id, saved.version)
    },
    t('cms.page.published'),
    show,
  )
const unpublish = () =>
  run(
    () => pages.unpublish(page.value!.id),
    t('cms.page.unpublished'),
    (next) => (page.value = next),
  )
async function remove() {
  confirming.value = false
  await run(() => pages.remove(page.value!.id), '')
  if (status.value?.kind !== 'ok') return
  draft.value = baseline.value
  await router.push({ name: 'cms.pages' })
}

const reload = (done = '') => run(() => pages.get(page.value!.id), done, show)
useDraftChanges({
  draft,
  baseline,
  save,
  busy: () => pending.value || revisionPending.value,
})
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
          <PublishActions
            :status="page.status"
            :published="page.published !== null"
            :pending="pending || revisionPending"
            :can-edit="canEdit"
            :can-publish="pages.can('cms.pages.publish')"
            :deletable="!page.systemKey"
            @publish="publish"
            @unpublish="unpublish"
            @delete="confirming = true"
          />
        </template>
      </PageHeader>
      <CachePurgeNotice :pending="pending || revisionPending" class="mb-4" />

      <ActionStatus :status="status" @reload="reload()" />

      <LocaleSwitch v-model="contentLocale" :locales="locales" class="mb-4" />
      <form ref="form" tabindex="-1" :aria-label="title" class="@container" @submit.prevent="save">
        <fieldset :disabled="pending || revisionPending" class="min-w-0">
          <div
            class="grid grid-cols-1 gap-4"
            :class="
              preview
                ? '@2xl:grid-cols-[20rem_minmax(0,1fr)] @5xl:grid-cols-[16rem_minmax(0,1fr)_22rem]'
                : 'md:grid-cols-[16rem_minmax(0,1fr)]'
            "
          >
            <PageOutline
              v-model:sections="draft.sections"
              v-model:selection="selection"
              :can-edit="canEdit"
              class="min-w-0"
            />
            <PreviewPane
              v-if="preview"
              v-model:content-locale="contentLocale"
              :page="page"
              :url="preview.url"
              :draft="draft"
              class="min-w-0 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1 @5xl:row-span-1"
              @select="focusField"
            />
            <section :aria-labelledby="inputsHeading" class="min-w-0 space-y-4">
              <h2 :id="inputsHeading" class="font-semibold text-highlighted">
                {{
                  selectedIndex === -1
                    ? t('cms.page.pageSettings')
                    : `${selectedIndex + 1}. ${typeLabel(draft.sections[selectedIndex]!.type)}`
                }}
              </h2>
              <div v-show="selection.kind === 'page'" class="space-y-6">
                <LocaleAvailability :value="draft.locales" :locales="locales" :disabled="locked" />
                <LocaleDetails
                  :value="draft.locales"
                  :locales="locales"
                  :locale="contentLocale"
                  :disabled="locked"
                />
              </div>
              <div
                v-for="(section, index) in draft.sections"
                v-show="index === selectedIndex"
                :id="`${panels}-${section.id}`"
                :key="section.id"
                tabindex="-1"
                class="space-y-4"
              >
                <FieldToggle
                  :model-value="section.hidden === true"
                  :name="`sections.${index}.hidden`"
                  :label="t('cms.page.hideSection')"
                  :help="t('cms.page.hideSectionHelp')"
                  :disabled="locked"
                  @update:model-value="setHidden(section, $event)"
                />
                <FieldsForm
                  v-if="definitions.sections[section.type]"
                  v-model:data="section.data"
                  :group="definitions.sections[section.type]!"
                  :locales="locales"
                  :locale="contentLocale"
                  :name="`sections.${index}`"
                  :disabled="locked"
                />
              </div>
            </section>
          </div>
        </fieldset>
      </form>
      <RevisionHistory
        v-if="page"
        v-model:content-locale="contentLocale"
        :version="page.version"
        kind="page"
        :document-ref="page.id"
        :published-revision-id="page.publishedRevisionId"
        :can-restore="pages.can('cms.pages.publish')"
        :disabled="pending"
        @busy="revisionPending = $event"
        @restored="reload(t('cms.revisions.restored'))"
        @reload="reload()"
      />

      <ConfirmDialog
        v-model:open="confirming"
        :title="t('cms.page.deleteTitle')"
        :description="t('cms.page.deleteWarning')"
        :confirm-label="t('cms.page.delete')"
        :loading="pending || revisionPending"
        danger
        @confirm="remove"
      />
    </template>
  </section>
</template>
