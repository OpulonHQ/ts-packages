import { useAdmin, useApiClient } from '@opulonjs/admin'
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { cmsContextKey } from './context.ts'
import {
  CmsConflict,
  type CmsDefinitions,
  CmsGroup,
  CmsInvalid,
  type Field,
  type ItemDocument,
  type ItemQuery,
  labelText,
  type MenuDocument,
  type PageDocument,
  type SettingsDocument,
  type PageSummary,
  type RedirectInput,
} from '../api.ts'

/**
 * Props of a cms field widget: built-in or registered with `cmsAdmin({ widgets })`. A widget
 * edits one value (one locale's, for localized fields) through `v-model`; null clears it.
 */
export interface CmsWidgetProps {
  modelValue: unknown
  field: Field
  /** Form path, e.g. `sections.0.title.en`. */
  name: string
  /** The field's label in the admin locale. */
  label: string
  disabled?: boolean
}

export const useCmsContext = () => {
  const context = inject(cmsContextKey)
  if (!context) throw new Error('cms screens must be mounted through cmsAdmin()')
  return context
}

/** The pages API for admin screens, plus what they show around it. */
export const usePages = () => {
  const cms = useApiClient(CmsGroup)
  const admin = useAdmin()
  return {
    list: () => cms((client) => client.listPages()),
    get: (id: string) => cms((client) => client.getPage({ params: { id } })),
    create: (draft: PageDocument) => cms((client) => client.createPage({ payload: draft })),
    save: (id: string, version: number, draft: PageDocument) =>
      cms((client) => client.saveDraft({ params: { id }, query: { version }, payload: draft })),
    remove: (id: string) => cms((client) => client.deletePage({ params: { id } })),
    publish: (id: string, version: number) =>
      cms((client) => client.publishPage({ params: { id }, query: { version } })),
    unpublish: (id: string) => cms((client) => client.unpublishPage({ params: { id } })),
    can: admin.can,
    contentLocales: computed(() => admin.me.value?.contentLocales ?? []),
  }
}

/** The redirects API for the redirects screen. */
export const useRedirects = () => {
  const cms = useApiClient(CmsGroup)
  const admin = useAdmin()
  return {
    list: () => cms((client) => client.listRedirects()),
    create: (input: RedirectInput) => cms((client) => client.createRedirect({ payload: input })),
    update: (id: string, input: RedirectInput) =>
      cms((client) => client.updateRedirect({ params: { id }, payload: input })),
    remove: (id: string) => cms((client) => client.deleteRedirect({ params: { id } })),
    importCsv: (csv: string) => cms((client) => client.importRedirects({ payload: { csv } })),
    can: admin.can,
    contentLocales: computed(() => admin.me.value?.contentLocales ?? []),
  }
}

/** The collections, site settings and menus API for admin screens. */
export const useContent = () => {
  const cms = useApiClient(CmsGroup)
  const admin = useAdmin()
  return {
    listItems: (collection: string, query: ItemQuery) =>
      cms((client) => client.listItems({ params: { collection }, query })),
    getItem: (id: string) => cms((client) => client.getItem({ params: { id } })),
    createItem: (collection: string, draft: ItemDocument) =>
      cms((client) => client.createItem({ params: { collection }, payload: draft })),
    saveItem: (id: string, version: number, draft: ItemDocument) =>
      cms((client) => client.saveItemDraft({ params: { id }, query: { version }, payload: draft })),
    removeItem: (id: string) => cms((client) => client.deleteItem({ params: { id } })),
    publishItem: (id: string, version: number) =>
      cms((client) => client.publishItem({ params: { id }, query: { version } })),
    unpublishItem: (id: string) => cms((client) => client.unpublishItem({ params: { id } })),
    getSettings: () => cms((client) => client.getSettings()),
    saveSettings: (version: number, draft: SettingsDocument) =>
      cms((client) => client.saveSettingsDraft({ query: { version }, payload: draft })),
    publishSettings: (version: number) =>
      cms((client) => client.publishSettings({ query: { version } })),
    unpublishSettings: () => cms((client) => client.unpublishSettings()),
    getMenu: (key: string) => cms((client) => client.getMenu({ params: { key } })),
    saveMenu: (key: string, version: number, draft: MenuDocument) =>
      cms((client) =>
        client.saveMenuDraft({ params: { key }, query: { version }, payload: draft }),
      ),
    publishMenu: (key: string, version: number) =>
      cms((client) => client.publishMenu({ params: { key }, query: { version } })),
    unpublishMenu: (key: string) => cms((client) => client.unpublishMenu({ params: { key } })),
    listPages: () => cms((client) => client.listPages()),
    can: admin.can,
    contentLocales: computed(() => admin.me.value?.contentLocales ?? []),
  }
}

export interface ActionResult {
  kind: 'ok' | 'error' | 'conflict'
  message: string
}

/**
 * Disabling the form while `locked` blurs the focused control to `<body>`; this gives focus back
 * when it ends, unless something else took focus meanwhile.
 */
export const useFocusReturn = (locked: () => boolean) => {
  let held: HTMLElement | undefined
  watch(
    locked,
    (now) => {
      if (now) {
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body) held = active
        return
      }
      void nextTick(() => {
        if (locked() || !held) return
        const element = held
        held = undefined
        const active = document.activeElement
        if (element.isConnected && (!active || active === document.body)) element.focus()
      })
    },
    { flush: 'sync' },
  )
}

/** Runs one editor action at a time: pending flag, then a success or failure message to show. */
export const useAction = (failed: () => string) => {
  const pending = ref(false)
  const status = ref<ActionResult>()
  let ticket = 0
  const invalidate = () => {
    ticket++
    pending.value = false
    status.value = undefined
  }
  onBeforeUnmount(invalidate)
  const run = async <T>(action: () => Promise<T>, done: string): Promise<T | undefined> => {
    if (pending.value) return undefined
    const request = ++ticket
    pending.value = true
    status.value = undefined
    try {
      const result = await action()
      if (request !== ticket) return undefined
      status.value = { kind: 'ok', message: done }
      return result
    } catch (error) {
      if (request === ticket) status.value = failureStatus(error, failed())
      return undefined
    } finally {
      if (request === ticket) pending.value = false
    }
  }
  return { pending, status, run, invalidate }
}

/** System pages go by their label in the admin locale, other pages by the server's title. */
export const pageTitle = (
  definitions: CmsDefinitions,
  page: Pick<PageSummary, 'systemKey' | 'title'>,
  locale: string,
) => {
  const system = page.systemKey === null ? undefined : definitions.systemPages[page.systemKey]
  return system ? labelText(system.label, locale) : page.title
}

/** The editor-facing message of a failure: the server's own for validation and conflicts. */
export const failureMessage = (error: unknown, fallback: string) =>
  error instanceof CmsInvalid || error instanceof CmsConflict ? error.message : fallback

export const failureStatus = (error: unknown, fallback: string): ActionResult => ({
  kind: error instanceof CmsConflict && error.reason === 'draft_changed' ? 'conflict' : 'error',
  message: failureMessage(error, fallback),
})
