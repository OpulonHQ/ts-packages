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
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { failedScreenKey, type NavTarget, type ShellNavItem, useAdmin } from '../state.ts'
import ScreenFailed from './ScreenFailed.vue'

const { brand, me, status, stale, nav, navTarget, signOut, accountRoute, setLocale } = useAdmin()
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
// The nav entry the screen belongs to: the one it names, else its route's `nav`, else its own.
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
// `active` is always set: a detail screen keeps its list's entry highlighted, and an entry with
// children only opens its group (each child opens the item's route with its params).
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

// A group opens itself for the screen shown and otherwise stays as the user left it.
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
            onSelect: signOut,
          },
        ],
      ]
    : []),
])
const reload = () => location.reload()
// The navbar names the section, on its detail screens too (the child's name under a group).
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
            <!-- The full logo (it includes the name) while expanded; the mark alone collapsed. -->
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
      </UDashboardPanel>
    </UDashboardGroup>
  </UApp>
</template>
