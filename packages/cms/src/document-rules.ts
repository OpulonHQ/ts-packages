import type { CmsDefinitions, Link } from './definitions.ts'

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const maxSections = 200

const urlPattern = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)\S*$/i

export const linkProblem = (
  definitions: Pick<CmsDefinitions, 'systemPages'>,
  link: Link,
): string | undefined => {
  switch (link.type) {
    case 'page':
    case 'item':
      return uuid.test(link.id) ? undefined : `The link points at no ${link.type}.`
    case 'system':
      return Object.hasOwn(definitions.systemPages, link.key)
        ? undefined
        : `The link points at the unknown system page "${link.key}".`
    case 'url':
      return urlPattern.test(link.url.trim())
        ? undefined
        : `The link URL "${link.url}" must start with https://, mailto:, tel: or "/".`
  }
}
