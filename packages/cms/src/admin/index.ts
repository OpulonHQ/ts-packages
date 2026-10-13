import { defineAdminModule, type Lazy } from '@opulonjs/admin'
import { defineAsyncComponent, defineComponent, h, provide, type Component } from 'vue'
import { cmsAuditActions, type CmsDefinitions, cmsPermissions } from '../api.ts'
import { cmsContextKey } from './use-cms.ts'

export type { CmsWidgetProps } from './use-cms.ts'

/** Widgets cms ships, named after their field kind. */
export const builtInWidgets = [
  'text',
  'textarea',
  'richText',
  'number',
  'select',
  'boolean',
  'media',
] as const

export interface CmsAdminOptions {
  /** The host's definitions file, the same one passed to `cms()` on the server. */
  readonly definitions: CmsDefinitions
  /** Custom field widgets by name (`fields.custom({ widget })`, or `widget` on any field). */
  readonly widgets?: Readonly<Record<string, Lazy<Component>>>
}

/**
 * The cms module's admin side: pages under Content, with forms generated from the definitions.
 * Fails at composition when a field names a widget that is neither built in nor registered.
 */
export const cmsAdmin = (options: CmsAdminOptions) => {
  const registered = options.widgets ?? {}
  const known = new Set<string>([...builtInWidgets, ...Object.keys(registered)])
  for (const [typeKey, type] of Object.entries(options.definitions.sections))
    for (const [name, field] of Object.entries(type.fields))
      if (!known.has(field.widget))
        throw new Error(
          `cmsAdmin: field "${name}" of section type "${typeKey}" uses the widget ` +
            `"${field.widget}", which is not registered. Add it to cmsAdmin({ widgets }).`,
        )
  const context = {
    definitions: options.definitions,
    widgets: Object.fromEntries(
      Object.entries(registered).map(([name, load]) => [
        name,
        defineAsyncComponent(() => load().then((m) => m.default)),
      ]),
    ),
  }
  // Screens read the definitions and widgets through provide/inject.
  const screen =
    (load: Lazy<Component>): Lazy<Component> =>
    async () => {
      const { default: inner } = await load()
      return {
        default: defineComponent({
          setup() {
            provide(cmsContextKey, context)
            return () => h(inner)
          },
        }),
      }
    }

  return defineAdminModule({
    id: 'cms',
    permissions: cmsPermissions,
    auditActions: cmsAuditActions,
    routes: [
      {
        name: 'cms.pages',
        path: '/cms/pages',
        permission: 'cms.pages.view',
        component: screen(() => import('./PagesScreen.vue')),
      },
      {
        name: 'cms.page',
        path: '/cms/pages/:id',
        permission: 'cms.pages.view',
        component: screen(() => import('./PageScreen.vue')),
      },
      {
        name: 'cms.redirects',
        path: '/cms/redirects',
        permission: 'cms.redirects.view',
        component: () => import('./RedirectsScreen.vue'),
      },
    ],
    nav: [
      { label: 'nav.pages', route: 'cms.pages', icon: 'i-lucide-file-text', group: 'content' },
      {
        label: 'nav.redirects',
        route: 'cms.redirects',
        icon: 'i-lucide-arrow-right-left',
        group: 'content',
      },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
}
