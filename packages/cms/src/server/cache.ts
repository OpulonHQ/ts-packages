/**
 * Cache-Tags of the Read API (TSPACK-11 §12). Every answer carries `cms`, plus:
 * - a page or item: `cms:page:<id>` / `cms:item:<id>`, and the tags of what its links point at;
 * - a collection list: `cms:collection:<key>` (an item's publish purges its collection);
 * - the site: `cms:site`, plus the tags of what menus, settings links and system pages point at;
 * - a redirect, not found and the sitemaps: `cms:routes`, purged whenever a published path or
 *   a redirect may have changed (any publish, unpublish or delete of a page or item, any
 *   redirect write).
 * Media dependencies carry `media:<id>` tags, including unresolved ids.
 */
export const cacheTags = {
  all: 'cms',
  page: (id: string) => `cms:page:${id}`,
  item: (id: string) => `cms:item:${id}`,
  collection: (key: string) => `cms:collection:${key}`,
  site: 'cms:site',
  routes: 'cms:routes',
} as const
