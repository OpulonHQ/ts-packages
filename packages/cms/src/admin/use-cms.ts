import { useAdmin, useApiClient } from '@opulonjs/admin'
import { computed, inject, ref, type Component, type InjectionKey } from 'vue'
import {
  CmsConflict,
  type CmsDefinitions,
  CmsGroup,
  CmsInvalid,
  type Field,
  type ItemDocument,
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

export interface CmsAdminContext {
  readonly definitions: CmsDefinitions
  readonly widgets: Readonly<Record<string, Component>>
}

export const cmsContextKey: InjectionKey<CmsAdminContext> = Symbol('@opulonjs/cms/admin')

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
    save: (id: string, draft: PageDocument) =>
      cms((client) => client.saveDraft({ params: { id }, payload: draft })),
    remove: (id: string) => cms((client) => client.deletePage({ params: { id } })),
    publish: (id: string) => cms((client) => client.publishPage({ params: { id } })),
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
    listItems: (collection: string) =>
      cms((client) => client.listItems({ params: { collection } })),
    getItem: (id: string) => cms((client) => client.getItem({ params: { id } })),
    createItem: (collection: string, draft: ItemDocument) =>
      cms((client) => client.createItem({ params: { collection }, payload: draft })),
    saveItem: (id: string, draft: ItemDocument) =>
      cms((client) => client.saveItemDraft({ params: { id }, payload: draft })),
    removeItem: (id: string) => cms((client) => client.deleteItem({ params: { id } })),
    publishItem: (id: string) => cms((client) => client.publishItem({ params: { id } })),
    unpublishItem: (id: string) => cms((client) => client.unpublishItem({ params: { id } })),
    getSettings: () => cms((client) => client.getSettings()),
    saveSettings: (draft: SettingsDocument) =>
      cms((client) => client.saveSettingsDraft({ payload: draft })),
    publishSettings: () => cms((client) => client.publishSettings()),
    unpublishSettings: () => cms((client) => client.unpublishSettings()),
    getMenu: (key: string) => cms((client) => client.getMenu({ params: { key } })),
    saveMenu: (key: string, draft: MenuDocument) =>
      cms((client) => client.saveMenuDraft({ params: { key }, payload: draft })),
    publishMenu: (key: string) => cms((client) => client.publishMenu({ params: { key } })),
    unpublishMenu: (key: string) => cms((client) => client.unpublishMenu({ params: { key } })),
    listPages: () => cms((client) => client.listPages()),
    can: admin.can,
    contentLocales: computed(() => admin.me.value?.contentLocales ?? []),
  }
}

/** Runs an editor action: pending flag, then a success or failure message to show. */
export const useAction = (failed: () => string) => {
  const pending = ref(false)
  const status = ref<{ kind: 'ok' | 'error'; message: string }>()
  const run = async <T>(action: () => Promise<T>, done: string): Promise<T | undefined> => {
    pending.value = true
    status.value = undefined
    try {
      const result = await action()
      status.value = { kind: 'ok', message: done }
      return result
    } catch (error) {
      status.value = { kind: 'error', message: failureMessage(error, failed()) }
      return undefined
    } finally {
      pending.value = false
    }
  }
  return { pending, status, run }
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
