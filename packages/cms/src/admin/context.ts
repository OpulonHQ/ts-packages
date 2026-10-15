import type { Component, InjectionKey } from 'vue'
import type { CmsDefinitions } from '../api.ts'

export interface CmsPreviewOptions {
  /**
   * The host site's page in preview mode, absolute or relative to the admin. The admin posts
   * the live preview only to this URL's origin.
   */
  readonly url: (page: {
    readonly id: string
    readonly path: string
    readonly locale: string
  }) => string
}

export interface CmsAdminContext {
  readonly definitions: CmsDefinitions
  readonly widgets: Readonly<Record<string, Component>>
  readonly preview: CmsPreviewOptions | undefined
}

export const cmsContextKey: InjectionKey<CmsAdminContext> = Symbol('@opulonjs/cms/admin')
