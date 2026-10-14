import { useApiClient } from '@opulonjs/admin'
import {
  CmsGroup,
  type ItemRevision,
  type MenuRevision,
  type PageRevision,
  type SettingsRevision,
} from '../api.ts'

export type RevisionTarget =
  | { kind: 'page'; ref: string }
  | { kind: 'item'; ref: string }
  | { kind: 'settings'; ref: string }
  | { kind: 'menu'; ref: string }

export type RevisionSnapshot =
  | { kind: 'page'; revision: PageRevision }
  | { kind: 'item'; revision: ItemRevision }
  | { kind: 'settings'; revision: SettingsRevision }
  | { kind: 'menu'; revision: MenuRevision }

export const useRevisions = () => {
  const cms = useApiClient(CmsGroup)
  return {
    list: (target: RevisionTarget, page: number) =>
      cms((client) => {
        const query = { page }
        switch (target.kind) {
          case 'page':
            return client.listPageRevisions({ params: { id: target.ref }, query })
          case 'item':
            return client.listItemRevisions({ params: { id: target.ref }, query })
          case 'settings':
            return client.listSettingsRevisions({ query })
          case 'menu':
            return client.listMenuRevisions({ params: { key: target.ref }, query })
        }
      }),
    get: async (target: RevisionTarget, revisionId: string): Promise<RevisionSnapshot> => {
      switch (target.kind) {
        case 'page':
          return {
            kind: 'page',
            revision: await cms((client) =>
              client.getPageRevision({ params: { id: target.ref, revisionId } }),
            ),
          }
        case 'item':
          return {
            kind: 'item',
            revision: await cms((client) =>
              client.getItemRevision({ params: { id: target.ref, revisionId } }),
            ),
          }
        case 'settings':
          return {
            kind: 'settings',
            revision: await cms((client) => client.getSettingsRevision({ params: { revisionId } })),
          }
        case 'menu':
          return {
            kind: 'menu',
            revision: await cms((client) =>
              client.getMenuRevision({ params: { key: target.ref, revisionId } }),
            ),
          }
      }
    },
    restore: async (target: RevisionTarget, revisionId: string, version: number) => {
      switch (target.kind) {
        case 'page':
          await cms((client) =>
            client.restorePageRevision({
              params: { id: target.ref, revisionId },
              query: { version },
            }),
          )
          break
        case 'item':
          await cms((client) =>
            client.restoreItemRevision({
              params: { id: target.ref, revisionId },
              query: { version },
            }),
          )
          break
        case 'settings':
          await cms((client) =>
            client.restoreSettingsRevision({ params: { revisionId }, query: { version } }),
          )
          break
        case 'menu':
          await cms((client) =>
            client.restoreMenuRevision({
              params: { key: target.ref, revisionId },
              query: { version },
            }),
          )
          break
      }
    },
  }
}
