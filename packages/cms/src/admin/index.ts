import { defineAdminModule, type Lazy } from '@opulonjs/admin'
import { defineAsyncComponent, defineComponent, h, provide, type Component } from 'vue'
import { cmsAuditActions, type CmsDefinitions, cmsPermissions, type FieldGroup } from '../api.ts'
import { cmsContextKey } from './context.ts'

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
  'link',
  'reference',
] as const

export interface CmsAdminOptions {
  /** The host's definitions file, the same one passed to `cms()` on the server. */
  readonly definitions: CmsDefinitions
  /** Custom field widgets by name (`fields.custom({ widget })`, or `widget` on any field). */
  readonly widgets?: Readonly<Record<string, Lazy<Component>>>
}

/**
 * The cms module's admin side: pages, collections, menus, site settings and redirects under
 * Content, with forms generated from the definitions.
 * Fails at composition when a field names a widget that is neither built in nor registered.
 */
export const cmsAdmin = (options: CmsAdminOptions) => {
  const registered = options.widgets ?? {}
  const known = new Set<string>([...builtInWidgets, ...Object.keys(registered)])
  const { definitions } = options
  const groups: Array<[string, FieldGroup]> = [
    ...Object.entries(definitions.sections).map(([k, g]): [string, FieldGroup] => [
      `section type "${k}"`,
      g,
    ]),
    ...Object.entries(definitions.collections).map(([k, g]): [string, FieldGroup] => [
      `collection "${k}"`,
      g,
    ]),
    ['site settings', definitions.settings],
  ]
  for (const [owner, group] of groups)
    for (const [name, field] of Object.entries(group.fields))
      if (!known.has(field.widget))
        throw new Error(
          `cmsAdmin: field "${name}" of ${owner} uses the widget ` +
            `"${field.widget}", which is not registered. Add it to cmsAdmin({ widgets }).`,
        )
  const hasCollections = Object.keys(definitions.collections).length > 0
  const hasMenus = Object.keys(definitions.menus).length > 0
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
        name: 'cms.collections',
        path: '/cms/collections/:collection?',
        permission: 'cms.collections.view',
        component: screen(() => import('./CollectionsScreen.vue')),
      },
      {
        name: 'cms.item',
        path: '/cms/items/:id',
        permission: 'cms.collections.view',
        component: screen(() => import('./ItemScreen.vue')),
      },
      {
        name: 'cms.settings',
        path: '/cms/settings',
        permission: 'cms.site.view',
        component: screen(() => import('./SettingsScreen.vue')),
      },
      {
        name: 'cms.menus',
        path: '/cms/menus/:key?',
        permission: 'cms.site.view',
        component: screen(() => import('./MenusScreen.vue')),
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
      ...(hasCollections
        ? [
            {
              label: 'nav.collections',
              route: 'cms.collections',
              icon: 'i-lucide-library',
              group: 'content',
            } as const,
          ]
        : []),
      ...(hasMenus
        ? [
            {
              label: 'nav.menus',
              route: 'cms.menus',
              icon: 'i-lucide-menu',
              group: 'content',
            } as const,
          ]
        : []),
      {
        label: 'nav.settings',
        route: 'cms.settings',
        icon: 'i-lucide-settings-2',
        group: 'content',
      },
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
