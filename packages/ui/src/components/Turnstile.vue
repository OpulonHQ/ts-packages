<script lang="ts">
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | undefined

const api = () => (window as { turnstile?: TurnstileApi }).turnstile

const load = () =>
  (loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const loaded = api()
    if (loaded) return resolve(loaded)
    const script = document.createElement('script')
    script.src = scriptUrl
    script.onload = () => {
      const loaded = api()
      if (loaded) resolve(loaded)
      else reject(new Error('Turnstile did not load'))
    }
    script.onerror = () => reject(new Error('Turnstile did not load'))
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = undefined
    throw error
  }))
</script>

<script setup lang="ts">
/**
 * Cloudflare Turnstile, for the admin and for host forms. The model is the token to post with
 * the form: undefined until the visitor passes, and again when the token expires. A token
 * passes the server check once, so call `reset()` after every post that used it.
 *
 * <Turnstile ref="check" v-model="token" site-key="1x00000000000000000000AA" action="contact" />
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ siteKey: string; action: string }>()
const token = defineModel<string | undefined>()
const container = ref<HTMLElement>()
let turnstile: TurnstileApi | undefined
let widget: string | undefined
let unmounted = false

onMounted(async () => {
  const loaded = await load().catch(() => undefined)
  if (!loaded || unmounted || !container.value) return
  turnstile = loaded
  const clear = () => {
    token.value = undefined
  }
  widget = loaded.render(container.value, {
    sitekey: props.siteKey,
    action: props.action,
    callback: (value) => {
      token.value = value
    },
    'expired-callback': clear,
    'error-callback': clear,
  })
})

onBeforeUnmount(() => {
  unmounted = true
  if (widget !== undefined) turnstile?.remove(widget)
})

defineExpose({
  /** Drops the token and asks for a new one. */
  reset: () => {
    token.value = undefined
    if (widget !== undefined) turnstile?.reset(widget)
  },
})
</script>

<template>
  <div ref="container" />
</template>
