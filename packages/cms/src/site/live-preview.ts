// The admin's live preview, both directions of its postMessage wire format and the site side.
// Effect-free: `vue` and type imports only.
import type { PagePreview } from '../api.ts'

/** Admin -> preview frame: the unsaved draft as the site renders it. */
export type AdminMessage = { readonly type: 'opulon:cms:preview'; readonly preview: PagePreview }

/** Preview frame -> admin. */
export type FrameMessage =
  | { readonly type: 'opulon:cms:ready' }
  | { readonly type: 'opulon:cms:select'; readonly sectionId: string; readonly field?: string }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isFilled = (value: unknown): value is string => isString(value) && value !== ''

const parsePreview = (value: unknown): PagePreview | undefined => {
  if (!isRecord(value) || !isString(value.id) || !isString(value.locale) || !isString(value.path))
    return undefined
  const seo = value.seo
  if (
    !isRecord(seo) ||
    !isString(seo.title) ||
    !isString(seo.description) ||
    !(seo.image === null || isString(seo.image)) ||
    typeof seo.noindex !== 'boolean'
  )
    return undefined
  if (!Array.isArray(value.sections)) return undefined
  const sections: Array<PagePreview['sections'][number]> = []
  for (const section of value.sections) {
    if (!isRecord(section) || !isString(section.id) || !isString(section.type)) return undefined
    if (!isRecord(section.data)) return undefined
    sections.push({ id: section.id, type: section.type, data: section.data })
  }
  return {
    id: value.id,
    locale: value.locale,
    path: value.path,
    seo: { title: seo.title, description: seo.description, image: seo.image, noindex: seo.noindex },
    sections,
  }
}

/** A message a preview frame received, if it is a well-formed `AdminMessage`. */
export const parseAdminMessage = (data: unknown): AdminMessage | undefined => {
  if (!isRecord(data) || data.type !== 'opulon:cms:preview') return undefined
  const preview = parsePreview(data.preview)
  return preview && { type: 'opulon:cms:preview', preview }
}

/** A message the admin received from its preview frame, if it is a well-formed `FrameMessage`. */
export const parseFrameMessage = (data: unknown): FrameMessage | undefined => {
  if (!isRecord(data)) return undefined
  if (data.type === 'opulon:cms:ready') return { type: 'opulon:cms:ready' }
  if (data.type !== 'opulon:cms:select' || !isFilled(data.sectionId)) return undefined
  if (data.field !== undefined && !isFilled(data.field)) return undefined
  return data.field === undefined
    ? { type: 'opulon:cms:select', sectionId: data.sectionId }
    : { type: 'opulon:cms:select', sectionId: data.sectionId, field: data.field }
}
