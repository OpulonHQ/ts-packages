<script setup lang="ts">
import {
  type DropdownMenuItem,
  type NavigationMenuItem,
  nuxtUiEn,
  nuxtUiSk,
  UAlert,
  UApp,
  UButton,
  UDashboardGroup,
  UDashboardNavbar,
  UDashboardPanel,
  UDashboardSidebar,
  UDashboardSidebarCollapse,
  UDropdownMenu,
  languageName,
  UNavigationMenu,
  useToast,
} from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import UnsavedChangesBar from '@opulonjs/ui/components/UnsavedChangesBar'
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { failedScreenKey, type NavTarget, type ShellNavItem, useAdmin } from '../state.ts'
import ScreenFailed from './ScreenFailed.vue'

const {
  brand,
  me,
  status,
  stale,
  nav,
  navTarget,
  signOut,
  accountRoute,
  setLocale,
  editors,
  confirmDiscard,
  discardRequest,
} = useAdmin()
const { t, locale, availableLocales } = useI18n()
const toast = useToast()
const route = useRoute()
const failedScreen = inject(failedScreenKey)

const uiLocale = computed(() => (locale.value === 'sk' ? nuxtUiSk : nuxtUiEn))
// Public routes (sign-in) and signed-out states render without the dashboard frame.
const bare = computed(() => route.meta.access?.public === true || status.value !== 'ready')

const routeParams = computed(() =>
  Object.fromEntries(
    Object.entries(route.params).map(([key, value]) => [
      key,
      String(Array.isArray(value) ? value[0] : value),
    ]),
  ),
)
const current = computed<NavTarget>(
  () =>
    navTarget.value ?? {
      route: route.meta.nav ?? String(route.name ?? ''),
      params: routeParams.value,
    },
)
const matches = (params: Readonly<Record<string, string>>) =>
  Object.entries(params).every(([key, value]) => current.value.params?.[key] === value)
const named = (label: string | Readonly<Record<string, string>>) =>
  typeof label === 'string'
    ? t(label)
    : (label[locale.value] ?? label.en ?? Object.values(label)[0] ?? '')
const toItem = (item: ShellNavItem): NavigationMenuItem => {
  const here = current.value.route === item.route
  const own = { label: t(item.label), icon: item.icon, active: here }
  if (!item.children?.length) return { ...own, to: { name: item.route } }
  return {
    ...own,
    value: item.route,
    children: item.children.map((child) => ({
      label: named(child.label),
      to: { name: item.route, params: child.params },
      active: here && matches(child.params),
    })),
  }
}
const items = computed<NavigationMenuItem[][]>(() => [
  [
    {
      label: t('admin.dashboard'),
      icon: 'i-lucide-house',
      to: { name: 'dashboard' },
      active: current.value.route === 'dashboard',
    },
    ...(nav.value[0] && !nav.value[0].id ? nav.value[0].items : []).map(toItem),
  ],
  ...nav.value
    .filter((group) => group.id)
    .map((group) => [
      { label: t(`admin.groups.${group.id}`), type: 'label' as const },
      ...group.items.map(toItem),
    ]),
])

const treeUi = {
  childList: 'border-s-0',
  childItem: [
    'relative ps-5',
    'before:absolute before:inset-y-0 before:start-0 before:border-s before:border-accented last:before:hidden',
    'after:absolute after:start-0 after:top-0 after:h-1/2 after:w-2.5 after:rounded-es-md after:border-s after:border-b after:border-accented',
    '[--tree-dot:var(--ui-border-accented)] has-[[data-active]]:[--tree-dot:var(--ui-text-highlighted)]',
    'bg-[radial-gradient(circle_at_12.5px_calc(50%_-_0.5px),var(--tree-dot)_2.5px,transparent_3px)] bg-no-repeat',
  ].join(' '),
}

const openGroups = ref<string[]>([])
const groupRoutes = computed(() =>
  nav.value.flatMap((group) => group.items.filter((i) => i.children?.length).map((i) => i.route)),
)
watch(
  [() => current.value.route, groupRoutes],
  ([shown, groups]) => {
    if (groups.includes(shown) && !openGroups.value.includes(shown))
      openGroups.value = [...openGroups.value, shown]
  },
  { immediate: true },
)
// Toasts are shared across admin apps, so an unmounted shell must not add one.
let mounted = true
onUnmounted(() => (mounted = false))
const chooseLocale = (code: string) =>
  setLocale?.(code).catch(() => {
    if (mounted)
      toast.add({ title: t('admin.languageFailed'), color: 'error', icon: 'i-lucide-circle-alert' })
  })
const userMenu = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', slot: 'identity' as const }],
  [
    ...(accountRoute
      ? [{ label: t('admin.account'), icon: 'i-lucide-user-cog', to: { name: accountRoute } }]
      : []),
    ...(setLocale
      ? [
          {
            label: t('admin.language'),
            icon: 'i-lucide-languages',
            children: availableLocales.map((code) => ({
              label: languageName(code),
              type: 'checkbox' as const,
              checked: locale.value === code,
              onSelect: () => chooseLocale(code),
            })),
          },
        ]
      : []),
  ],
  ...(signOut
    ? [
        [
          {
            label: t('admin.signOut'),
            icon: 'i-lucide-log-out',
            color: 'error' as const,
            // Signing out ends the session, so the leave guard cannot ask afterwards: ask here.
            onSelect: async () => {
              if (unsaved() && !(await confirmDiscard())) return
              await signOut()
            },
          },
        ],
      ]
    : []),
])
// The newest editor with a bar owns it while it has unsaved changes; Discard asks first.
const editor = computed(() => [...editors].reverse().find((e) => e.bar))
const unsaved = () => editors.some((e) => e.dirty() && !e.busy())
const discard = async () => {
  const target = editor.value
  if (target && (await confirmDiscard())) target.discard?.()
}
const discardOpen = computed({
  get: () => discardRequest.value !== undefined,
  set: (open) => {
    if (!open) discardRequest.value?.(false)
  },
})
// Cmd/Ctrl+S saves the newest editor that saves, and never opens the browser's own dialog over it.
const onKeydown = (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
  if (event.key.toLowerCase() !== 's' || event.defaultPrevented) return
  const target = [...editors].reverse().find((e) => e.save)
  if (!target) return
  event.preventDefault()
  // Not behind an open dialog (a delete confirmation, a picker): it is not what the user sees.
  if (document.querySelector('[role="dialog"]')) return
  if (target.dirty() && !target.busy()) target.save?.()
}
let leaving = false
const onBeforeUnload = (event: BeforeUnloadEvent) => {
  if (leaving || !unsaved()) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
const reload = async () => {
  if (unsaved() && !(await confirmDiscard())) return
  leaving = true
  location.reload()
}
const title = computed(() => {
  if (current.value.route === 'dashboard') return t('admin.dashboard')
  const entry = nav.value.flatMap((g) => g.items).find((i) => i.route === current.value.route)
  if (!entry) return ''
  const child = entry.children?.find((c) => matches(c.params))
  return child ? named(child.label) : t(entry.label)
})
</script>

<template>
  <UApp :locale="uiLocale">
    <div v-if="stale" role="alert" class="relative z-50">
      <UAlert
        color="primary"
        variant="solid"
        icon="i-lucide-refresh-cw"
        :title="t('admin.reload.message')"
        :actions="[
          { label: t('admin.reload.action'), color: 'neutral', variant: 'subtle', onClick: reload },
        ]"
        :ui="{ root: 'rounded-none' }"
      />
    </div>

    <main v-if="bare" class="min-h-svh">
      <div v-if="status === 'failed'" class="mx-auto max-w-md p-6">
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="t('admin.meFailed')"
        />
      </div>
      <p v-else-if="status === 'loading'" class="p-6 text-muted" aria-live="polite">
        {{ t('admin.loading') }}
      </p>
      <template v-else>
        <ScreenFailed v-if="failedScreen" />
        <RouterView />
      </template>
    </main>

    <UDashboardGroup v-else unit="rem" storage="local">
      <UDashboardSidebar collapsible resizable :ui="{ footer: 'border-t border-default' }">
        <template #header="{ collapsed }">
          <RouterLink
            :to="{ name: 'dashboard' }"
            class="flex min-w-0 items-center gap-2 rounded-md font-semibold text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <template v-if="brand.wordmark && !collapsed">
              <img
                :src="brand.wordmark"
                :alt="brand.name"
                class="block h-auto max-h-9 w-auto max-w-full"
                :class="brand.wordmarkDark && 'dark:hidden'"
              />
              <img
                v-if="brand.wordmarkDark"
                :src="brand.wordmarkDark"
                :alt="brand.name"
                class="hidden h-auto max-h-9 w-auto max-w-full dark:block"
              />
            </template>
            <template v-else>
              <img
                v-if="brand.logo"
                :src="brand.logo"
                alt=""
                class="size-6 shrink-0"
                :class="brand.logoDark && 'dark:hidden'"
              />
              <img
                v-if="brand.logo && brand.logoDark"
                :src="brand.logoDark"
                alt=""
                class="hidden size-6 shrink-0 dark:block"
              />
              <span v-if="!collapsed" class="truncate">{{ brand.name }}</span>
              <span v-else class="sr-only">{{ brand.name }}</span>
            </template>
          </RouterLink>
        </template>
        <template #default="{ collapsed }">
          <nav :aria-label="t('admin.navigation')">
            <UNavigationMenu
              v-model="openGroups"
              type="multiple"
              :collapsed="collapsed"
              :items="items"
              :ui="collapsed ? undefined : treeUi"
              orientation="vertical"
              tooltip
              popover
            />
          </nav>
        </template>
        <template #footer="{ collapsed }">
          <UDropdownMenu
            v-if="me"
            :items="userMenu"
            :content="{ align: 'center', collisionPadding: 12 }"
            :ui="{ content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              block
              :square="collapsed"
              :aria-label="t('admin.userMenu')"
              :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
              class="data-[state=open]:bg-elevated"
              :ui="{ trailingIcon: 'text-dimmed' }"
            >
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated font-medium text-highlighted"
                aria-hidden="true"
              >
                {{ me.user.name.charAt(0) }}
              </span>
              <span v-if="!collapsed" class="min-w-0 flex-1 text-left">
                <span class="block truncate font-medium text-highlighted">{{ me.user.name }}</span>
                <span class="block truncate text-xs font-normal text-muted">{{
                  me.user.email
                }}</span>
              </span>
            </UButton>
            <template #identity>
              <span class="block min-w-0 text-left">
                <span class="block truncate font-medium text-highlighted">{{ me.user.name }}</span>
                <span class="block truncate text-xs font-normal text-muted">{{
                  me.user.email
                }}</span>
              </span>
            </template>
          </UDropdownMenu>
        </template>
      </UDashboardSidebar>

      <UDashboardPanel>
        <template #header>
          <UDashboardNavbar :title="title">
            <template #leading>
              <UDashboardSidebarCollapse />
            </template>
          </UDashboardNavbar>
        </template>
        <template #body>
          <ScreenFailed v-if="failedScreen" />
          <RouterView />
        </template>
        <template #footer>
          <!-- Always in the page, so screen readers hear the bar appear and go. -->
          <p class="sr-only" aria-live="polite">{{ editor?.dirty() ? t('admin.unsaved') : '' }}</p>
          <Transition
            enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
            enter-from-class="translate-y-2 opacity-0"
            leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
            leave-to-class="translate-y-2 opacity-0"
          >
            <UnsavedChangesBar
              v-if="editor?.dirty()"
              :save-label="editor.saveLabel?.()"
              :busy="editor.busy()"
              @save="editor.save?.()"
              @discard="discard"
            />
          </Transition>
        </template>
      </UDashboardPanel>
    </UDashboardGroup>

    <ConfirmDialog
      v-model:open="discardOpen"
      :title="t('admin.discard.title')"
      :description="t('admin.discard.description')"
      :confirm-label="t('admin.discard.confirm')"
      :cancel-label="t('admin.discard.cancel')"
      danger
      @confirm="discardRequest?.(true)"
    />
  </UApp>
</template>
