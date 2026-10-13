import { useAdmin, useApiClient } from '@opulonjs/admin'
import { computed, inject, type Component, type InjectionKey } from 'vue'
import {
  CmsConflict,
  type CmsDefinitions,
  CmsGroup,
  CmsInvalid,
  type Field,
  labelText,
  type PageDocument,
  type PageSummary,
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
