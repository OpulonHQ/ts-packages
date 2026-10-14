import type { Component, InjectionKey } from 'vue'
import type { CmsDefinitions } from '../api.ts'

export interface CmsAdminContext {
  readonly definitions: CmsDefinitions
  readonly widgets: Readonly<Record<string, Component>>
}

export const cmsContextKey: InjectionKey<CmsAdminContext> = Symbol('@opulonjs/cms/admin')
