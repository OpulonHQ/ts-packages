<script setup lang="ts">
import { useApiClient, useI18n, useRoute } from '@opulonjs/admin'
import { UButton, UInput, USelectMenu, USwitch } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import LocaleTabs from '@opulonjs/ui/components/LocaleTabs'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import RichTextControl from '@opulonjs/ui/components/RichTextControl'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed, reactive, ref } from 'vue'
import {
  type EmailComponentInfo,
  type EmailContent,
  EmailsGroup,
  type EmailTemplateInfo,
  TemplateInvalid,
} from '../api.ts'

const { t, te } = useI18n()
const route = useRoute()
const key = String(route.params.key)
const emails = useApiClient(EmailsGroup)

const template = ref<EmailTemplateInfo>()
const components = ref<ReadonlyArray<EmailComponentInfo>>([])
const status = ref<'loading' | 'ready' | 'notFound' | 'failed'>('loading')
/** The wording being edited, per locale. */
const drafts = reactive<Record<string, { subject: string; body: string | null }>>({})
/** Per locale: the last outcome shown under the editor. */
const notices = reactive<Record<string, { error: boolean; text: string }>>({})
const previews = reactive<Record<string, string>>({})
const busy = ref(false)
const resetting = ref<string>()
const editors: Record<string, { insert: (content: string) => void } | null> = {}

emails((client) => client.templates()).then(
  (list) => {
    template.value = list.templates.find((x) => x.key === key)
    components.value = list.components
    status.value = template.value ? 'ready' : 'notFound'
    for (const l of template.value?.locales ?? []) setDraft(l.locale, l.override ?? l.default)
  },
  () => (status.value = 'failed'),
)

function setDraft(locale: string, content: EmailContent | null) {
  drafts[locale] = { subject: content?.subject ?? '', body: content?.body ?? null }
}

const entry = (locale: string) => template.value?.locales.find((l) => l.locale === locale)
const locales = computed(() => template.value?.locales.map((l) => l.locale) ?? [])
const content = (locale: string): EmailContent => ({
  subject: drafts[locale]?.subject ?? '',
  body: drafts[locale]?.body ?? '',
})

/** Runs one request, showing its outcome (or the server's validation message) for `locale`. */
async function run<A>(locale: string, request: () => Promise<A>, done?: string) {
  busy.value = true
  try {
    const result = await request()
    if (done) notices[locale] = { error: false, text: done }
    return result
  } catch (error) {
    notices[locale] = {
      error: true,
      text: error instanceof TemplateInvalid ? error.message : t('emails.editor.failed'),
    }
    return undefined
  } finally {
    busy.value = false
  }
}

async function save(locale: string) {
  const saved = await run(
    locale,
    () => emails((c) => c.saveOverride({ params: { key, locale }, payload: content(locale) })),
    t('emails.editor.saved'),
  )
  if (!saved) return
  setDraft(locale, saved)
  const l = entry(locale)
  if (l && template.value)
    template.value = {
      ...template.value,
      locales: template.value.locales.map((x) => (x === l ? { ...x, override: saved } : x)),
    }
}

async function reset(locale: string) {
  resetting.value = undefined
  const l = entry(locale)
  const done = await run(
    locale,
    () => emails((c) => c.resetOverride({ params: { key, locale } })).then(() => true),
    t('emails.editor.resetDone'),
  )
  if (!done || !l || !template.value) return
  setDraft(locale, l.default)
  template.value = {
    ...template.value,
    locales: template.value.locales.map((x) => (x === l ? { ...x, override: null } : x)),
  }
}

async function preview(locale: string) {
  const rendered = await run(locale, () =>
    emails((c) => c.preview({ params: { key }, payload: { locale, ...content(locale) } })),
  )
  if (rendered) previews[locale] = rendered.html
}

const testSend = (locale: string) =>
  run(
    locale,
    () => emails((c) => c.testSend({ params: { key }, payload: { locale } })),
    t('emails.editor.testSent'),
  )

async function setEnabled(enabled: boolean) {
  const current = template.value
  if (!current) return
  template.value = { ...current, enabled }
  try {
    await emails((c) => c.setEnabled({ params: { key }, payload: { enabled } }))
  } catch {
    template.value = current
  }
}

// Component insertion: pick one, fill its props, insert `[[name prop="value"]]`.
const componentName = ref<string>()
const componentProps = reactive<Record<string, string>>({})
const chosen = computed(() => components.value.find((c) => c.name === componentName.value))
const componentLabel = (name: string) =>
  te(`emails.components.${name}`) ? t(`emails.components.${name}`) : name
const componentItems = computed(() =>
  components.value.map((c) => ({ label: componentLabel(c.name), value: c.name })),
)
const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function insertComponent(locale: string) {
  const c = chosen.value
  if (!c) return
  const args = c.props
    // A value may not close the attribute or the token.
    .map((p) => [p.name, (componentProps[p.name] ?? '').replace(/["[\]]/g, '')] as const)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')
  editors[locale]?.insert(`<p>${escapeText(`[[${c.name}${args}]]`)}</p>`)
}
</script>

<template>
  <section>
    <PageHeader
      :title="key"
      :breadcrumbs="[
        { label: t('emails.editor.back'), to: { name: 'emails.templates' } },
        { label: key },
      ]"
    />
    <p v-if="status === 'failed'" role="alert" class="text-error">
      {{ t('emails.editor.failed') }}
    </p>
    <p v-else-if="status === 'notFound'" role="alert">{{ t('emails.editor.notFound') }}</p>
    <div v-else-if="template" class="space-y-4">
      <USwitch
        :model-value="template.enabled"
        :label="t('emails.editor.enabled')"
        :disabled="busy"
        @update:model-value="setEnabled"
      />
      <LocaleTabs :locales="locales">
        <template v-for="l in template.locales" :key="l.locale" #[l.locale]>
          <div v-if="drafts[l.locale]" class="space-y-4">
            <StatusBadge
              :status="l.override ? 'active' : 'draft'"
              :label="t(l.override ? 'emails.editor.customized' : 'emails.editor.usingDefault')"
            />
            <p v-if="!l.default" class="text-sm text-muted">{{ t('emails.editor.noDefault') }}</p>
            <FieldText
              v-model="drafts[l.locale]!.subject"
              :name="`subject-${l.locale}`"
              :label="t('emails.editor.subject')"
              :maxlength="255"
              required
            />
            <div class="space-y-2">
              <p class="text-sm font-medium">{{ t('emails.editor.body') }}</p>
              <div
                class="flex flex-wrap items-center gap-1"
                role="group"
                :aria-label="t('emails.editor.placeholder')"
              >
                <UButton
                  v-for="p in template.placeholders"
                  :key="p.name"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :label="`{{${p.name}}}`"
                  :title="p.sample"
                  @click="editors[l.locale]?.insert(`{{${p.name}}}`)"
                />
              </div>
              <RichTextControl
                :ref="(el) => (editors[l.locale] = el as { insert: (c: string) => void } | null)"
                v-model="drafts[l.locale]!.body"
              />
              <div
                class="flex flex-wrap items-end gap-2"
                role="group"
                :aria-label="t('emails.editor.component')"
              >
                <USelectMenu
                  v-model="componentName"
                  :items="componentItems"
                  value-key="value"
                  :placeholder="t('emails.editor.component')"
                  :aria-label="t('emails.editor.component')"
                  class="w-48"
                />
                <UInput
                  v-for="p in chosen?.props ?? []"
                  :key="p.name"
                  v-model="componentProps[p.name]"
                  :placeholder="p.name"
                  :aria-label="p.name"
                  :type="p.kind === 'url' ? 'url' : 'text'"
                />
                <UButton
                  :label="t('emails.editor.insert')"
                  color="neutral"
                  variant="outline"
                  :disabled="!chosen"
                  @click="insertComponent(l.locale)"
                />
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton :label="t('emails.editor.save')" :loading="busy" @click="save(l.locale)" />
              <UButton
                :label="t('emails.editor.preview')"
                color="neutral"
                variant="outline"
                :disabled="busy"
                @click="preview(l.locale)"
              />
              <UButton
                :label="t('emails.editor.testSend')"
                color="neutral"
                variant="outline"
                :disabled="busy"
                @click="testSend(l.locale)"
              />
              <UButton
                v-if="l.override"
                :label="t('emails.editor.reset')"
                color="error"
                variant="ghost"
                :disabled="busy"
                @click="resetting = l.locale"
              />
            </div>
            <p
              v-if="notices[l.locale]"
              :role="notices[l.locale]!.error ? 'alert' : 'status'"
              :class="notices[l.locale]!.error ? 'text-error' : 'text-success'"
            >
              {{ notices[l.locale]!.text }}
            </p>
            <iframe
              v-if="previews[l.locale]"
              :title="t('emails.editor.preview')"
              sandbox=""
              :srcdoc="previews[l.locale]"
              class="h-[32rem] w-full rounded-md border border-default bg-white"
            />
          </div>
        </template>
      </LocaleTabs>
      <ConfirmDialog
        :open="resetting !== undefined"
        :title="t('emails.editor.reset')"
        :description="t('emails.editor.resetConfirm')"
        :confirm-label="t('emails.editor.reset')"
        danger
        @update:open="(open: boolean) => !open && (resetting = undefined)"
        @confirm="resetting && reset(resetting)"
      />
    </div>
  </section>
</template>
