// The admin's live preview, both directions of its postMessage wire format and the site side.
// Effect-free: `vue` and type imports only.
import {
  computed,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  provide,
  readonly,
  type Ref,
  ref,
  shallowRef,
  toValue,
} from 'vue'
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

/** Whether `CmsSections` renders inside an active live preview (it then marks section roots). */
export const liveKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('opulon:cms:live')

export interface CmsLivePreviewOptions {
  /** The admin's origin; without an http(s) one the preview never goes live. */
  readonly adminOrigin: string | undefined
}

const httpOrigin = (value: string | undefined) => {
  if (value === undefined || !URL.canParse(value)) return undefined
  const url = new URL(value)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
}

const elementOf = (target: EventTarget | null) =>
  target instanceof Element ? target : target instanceof Node ? target.parentElement : null

/**
 * The page preview to render: `initial`, replaced by the admin's unsaved draft of the same page
 * and locale while the page runs framed in the admin with `?preview` in its URL. A click on a
 * section (marked by `CmsSections`) or on a part marked `data-cms-field="<field>"` selects it in
 * the admin instead of acting. Server rendering and hydration see `initial` only.
 */
export const useCmsLivePreview = (
  initial: MaybeRefOrGetter<PagePreview | null | undefined>,
  options: CmsLivePreviewOptions,
): ComputedRef<PagePreview | undefined> => {
  const live = ref(false)
  const received = shallowRef<PagePreview>()
  provide(liveKey, readonly(live))
  const preview = computed(() => {
    const base = toValue(initial) ?? undefined
    const next = received.value
    return next && (!base || (next.id === base.id && next.locale === base.locale)) ? next : base
  })

  onMounted(() => {
    const origin = httpOrigin(options.adminOrigin)
    const admin = window.parent
    if (!origin || admin === window || !new URLSearchParams(location.search).has('preview')) return
    const post = (message: FrameMessage) => admin.postMessage(message, origin)

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== admin) return
      const message = parseAdminMessage(event.data)
      if (message) received.value = message.preview
    }
    const onClick = (event: Event) => {
      const target = elementOf(event.target)
      const section = target?.closest('[data-cms-section]')
      const sectionId = section?.getAttribute('data-cms-section')
      if (!target || !section || !sectionId) return
      if (!preview.value?.sections.some((s) => s.id === sectionId)) return
      const field = target.closest('[data-cms-field]')
      const name = field && section.contains(field) ? field.getAttribute('data-cms-field') : null
      event.preventDefault()
      event.stopPropagation()
      post(
        name
          ? { type: 'opulon:cms:select', sectionId, field: name }
          : { type: 'opulon:cms:select', sectionId },
      )
    }

    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick, true)
    live.value = true
    onScopeDispose(() => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('click', onClick, true)
      live.value = false
    })
    post({ type: 'opulon:cms:ready' })
  })

  return preview
}
