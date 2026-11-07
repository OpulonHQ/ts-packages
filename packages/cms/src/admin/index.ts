import { defineAdminModule, type Lazy } from '@opulonjs/admin'
import { defineAsyncComponent, defineComponent, h, provide, type Component } from 'vue'
import {
  cmsAuditActions,
  type CmsDefinitions,
  cmsPermissions,
  type FieldGroup,
  type Label,
} from '../api.ts'
import { cmsContextKey, type CmsPreviewOptions } from './context.ts'
import EditorFailed from './EditorFailed.vue'

export type { CmsPreviewOptions } from './context.ts'
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
  /** The host site's page in preview mode, shown live beside the page editor. */
  readonly preview?: CmsPreviewOptions
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
  // A host name for the sidebar; a plain string is the same name in every admin locale.
  const navLabel = (label: Label) => (typeof label === 'string' ? { en: label } : label)
  const context = {
    definitions: options.definitions,
    preview: options.preview,
    widgets: Object.fromEntries(
      Object.entries(registered).map(([name, load]) => [
        name,
        defineAsyncComponent({
          loader: () => load().then((m) => m.default),
          errorComponent: EditorFailed,
        }),
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
        nav: 'cms.pages',
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
        nav: 'cms.collections',
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
    // Content reads Pages, Collections, Menus, Media (order 40, media), Redirects, Site settings
    // whatever order the host lists its modules in; each collection and menu is its own entry.
    nav: [
      {
        label: 'nav.pages',
        route: 'cms.pages',
        icon: 'i-lucide-file-text',
        group: 'content',
        order: 10,
      },
      ...(hasCollections
        ? [
            {
              label: 'nav.collections',
              route: 'cms.collections',
              icon: 'i-lucide-library',
              group: 'content',
              order: 20,
              children: Object.entries(definitions.collections).map(([key, c]) => ({
                label: navLabel(c.label),
                params: { collection: key },
              })),
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
              order: 30,
              children: Object.entries(definitions.menus).map(([key, m]) => ({
                label: navLabel(m.label),
                params: { key },
              })),
            } as const,
          ]
        : []),
      {
        label: 'nav.redirects',
        route: 'cms.redirects',
        icon: 'i-lucide-arrow-right-left',
        group: 'content',
        order: 50,
      },
      {
        label: 'nav.settings',
        route: 'cms.settings',
        icon: 'i-lucide-settings-2',
        group: 'content',
        order: 60,
      },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
}
