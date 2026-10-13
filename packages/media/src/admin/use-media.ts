import { useAdmin, useApiClient } from '@opulonjs/admin'
import type { TablePage, TableQuery } from '@opulonjs/ui'
import { computed } from 'vue'
import { type LocalizedText, type MediaItem, MediaGroup, MediaRejected } from '../api.ts'

const formData = (file: File) => {
  const data = new FormData()
  data.append('file', file)
  return data
}

/** The media API for admin screens, plus what they show around it. */
export const useMedia = () => {
  const media = useApiClient(MediaGroup)
  const admin = useAdmin()
  return {
    /** A DataTable `load` over the library; `fixed` filters apply on top of the table's. */
    load:
      (fixed: { type?: 'image' | 'pdf'; status?: 'active' | 'archived' } = {}) =>
      (query: TableQuery): Promise<TablePage<MediaItem>> => {
        const { type, status } = { ...query.filters, ...fixed }
        return media((client) =>
          client.list({
            query: {
              page: query.page,
              perPage: query.perPage,
              ...(query.search ? { search: query.search } : {}),
              ...(type === 'image' || type === 'pdf' ? { type } : {}),
              ...(status === 'archived' ? { status } : {}),
            },
          }),
        )
      },
    get: (id: string) => media((client) => client.get({ params: { id } })),
    upload: (file: File) => media((client) => client.upload({ payload: formData(file) })),
    replace: (id: string, file: File) =>
      media((client) => client.replace({ params: { id }, payload: formData(file) })),
    update: (id: string, text: { alt: LocalizedText; caption: LocalizedText }) =>
      media((client) => client.update({ params: { id }, payload: text })),
    archive: (id: string) => media((client) => client.archive({ params: { id } })),
    restore: (id: string) => media((client) => client.restore({ params: { id } })),
    can: admin.can,
    contentLocales: computed(() => admin.me.value?.contentLocales ?? []),
  }
}

/** The editor-facing message of a failure: the server's own for a rejected upload. */
export const failureMessage = (error: unknown, fallback: string) =>
  error instanceof MediaRejected ? error.message : fallback

export const accept = (type?: 'image' | 'pdf') =>
  type === 'pdf'
    ? 'application/pdf'
    : type === 'image'
      ? 'image/jpeg,image/png,image/webp,image/avif,image/gif'
      : 'image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf'

export const formatSize = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: bytes >= 1048576 ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(bytes >= 1048576 ? bytes / 1048576 : bytes / 1024)
