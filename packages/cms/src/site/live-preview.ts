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
  watchEffect,
} from 'vue'
import type { PagePreview } from '../api.ts'
import { isRecord } from '../localize.ts'

export type AdminMessage = { readonly type: 'opulon:cms:preview'; readonly preview: PagePreview }

export type FrameMessage =
  | { readonly type: 'opulon:cms:ready' }
  | { readonly type: 'opulon:cms:select'; readonly sectionId: string; readonly field?: string }

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

const parseAdminMessage = (data: unknown): AdminMessage | undefined => {
  if (!isRecord(data) || data.type !== 'opulon:cms:preview') return undefined
  const preview = parsePreview(data.preview)
  return preview && { type: 'opulon:cms:preview', preview }
}

export const parseFrameMessage = (data: unknown): FrameMessage | undefined => {
  if (!isRecord(data)) return undefined
  if (data.type === 'opulon:cms:ready') return { type: 'opulon:cms:ready' }
  if (data.type !== 'opulon:cms:select' || !isFilled(data.sectionId)) return undefined
  if (data.field !== undefined && !isFilled(data.field)) return undefined
  return data.field === undefined
    ? { type: 'opulon:cms:select', sectionId: data.sectionId }
    : { type: 'opulon:cms:select', sectionId: data.sectionId, field: data.field }
}

export const liveKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('opulon:cms:live')

export interface CmsLivePreviewOptions {
  /** The admin's origin; without an http(s) one the preview never goes live. */
  readonly adminOrigin: string | undefined
}

export const httpUrl = (value: string | undefined, base?: string) => {
  if (value === undefined || !URL.canParse(value, base)) return undefined
  const url = new URL(value, base)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
}

const elementOf = (target: EventTarget | null) =>
  target instanceof Element ? target : target instanceof Node ? target.parentElement : null

/**
 * The page preview to render: `initial`, replaced by the admin's unsaved draft of the same page
 * (in the language the admin previews) while the page runs framed in the admin with `?preview`
 * in its URL. A click on a section (marked by `CmsSections`) or on a part marked
 * `data-cms-field="<field>"` selects it in the admin instead of acting. Live mode ends, and the
 * draft is dropped, when the URL loses `?preview` or `options` (which may be reactive) loses its
 * admin origin. Server rendering and hydration see `initial` only.
 */
export const useCmsLivePreview = (
  initial: MaybeRefOrGetter<PagePreview | null | undefined>,
  options: CmsLivePreviewOptions,
): ComputedRef<PagePreview | undefined> => {
  const live = ref(false)
  const received = shallowRef<PagePreview>()
  provide(liveKey, readonly(live))
  const samePage = (next: PagePreview) => {
    const base = toValue(initial)
    return !base || next.id === base.id
  }
  const preview = computed(() =>
    received.value && samePage(received.value) ? received.value : (toValue(initial) ?? undefined),
  )

  onMounted(() => {
    const admin = window.parent
    if (admin === window) return
    const search = ref(location.search)
    const syncUrl = () => (search.value = location.search)
    const inPreview = computed(() => new URLSearchParams(search.value).has('preview'))
    const stillInPreview = () => (syncUrl(), inPreview.value)
    const origin = computed(() => httpUrl(options.adminOrigin)?.origin)
    window.navigation?.addEventListener('currententrychange', syncUrl)
    onScopeDispose(() => window.navigation?.removeEventListener('currententrychange', syncUrl))

    watchEffect((onCleanup) => {
      const adminOrigin = origin.value
      if (!adminOrigin || !inPreview.value) return
      const post = (message: FrameMessage) => admin.postMessage(message, adminOrigin)

      const onMessage = (event: MessageEvent) => {
        if (!stillInPreview() || event.origin !== adminOrigin || event.source !== admin) return
        const message = parseAdminMessage(event.data)
        if (message && samePage(message.preview)) received.value = message.preview
      }
      const onClick = (event: Event) => {
        if (!stillInPreview()) return
        const target = elementOf(event.target)
        const section = target?.closest('[data-cms-section]')
        const sectionId = section?.getAttribute('data-cms-section')
        if (!target || !section || !sectionId) return
        if (!preview.value?.sections.some((s) => s.id === sectionId)) return
        const field = target.closest('[data-cms-field]')
        const name = field && section.contains(field) ? field.getAttribute('data-cms-field') : null
        event.preventDefault()
        event.stopPropagation()
        post({ type: 'opulon:cms:select', sectionId, field: name ?? undefined })
      }

      window.addEventListener('message', onMessage)
      document.addEventListener('click', onClick, true)
      live.value = true
      onCleanup(() => {
        window.removeEventListener('message', onMessage)
        document.removeEventListener('click', onClick, true)
        received.value = undefined
        live.value = false
      })
      post({ type: 'opulon:cms:ready' })
    })
  })

  return preview
}
