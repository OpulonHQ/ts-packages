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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAdmin } from '../state.ts'

const { brand, me, status, stale, nav, signOut, accountRoute, setLocale } = useAdmin()
const { t, locale, availableLocales } = useI18n()
const toast = useToast()
const route = useRoute()

const uiLocale = computed(() => (locale.value === 'sk' ? nuxtUiSk : nuxtUiEn))
// Public routes (sign-in) and signed-out states render without the dashboard frame.
const bare = computed(() => route.meta.access?.public === true || status.value !== 'ready')

const items = computed<NavigationMenuItem[][]>(() => [
  [
    { label: t('admin.dashboard'), icon: 'i-lucide-house', to: { name: 'dashboard' } },
    ...(nav.value[0] && !nav.value[0].id ? nav.value[0].items : []).map((item) => ({
      label: t(item.label),
      icon: item.icon,
      to: { name: item.route },
    })),
  ],
  ...nav.value
    .filter((group) => group.id)
    .map((group) => [
      { label: t(`admin.groups.${group.id}`), type: 'label' as const },
      ...group.items.map((item) => ({
        label: t(item.label),
        icon: item.icon,
        to: { name: item.route },
      })),
    ]),
])
const chooseLocale = (code: string) =>
  setLocale?.(code).catch(() =>
    toast.add({ title: t('admin.languageFailed'), color: 'error', icon: 'i-lucide-circle-alert' }),
  )
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
const title = computed(() => {
  const current = items.value
    .flat()
    .find((i) => i.to && route.name === (i.to as { name: string }).name)
  return current?.label ?? ''
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
      <RouterView v-else />
    </main>

    <UDashboardGroup v-else unit="rem" storage="local">
      <UDashboardSidebar collapsible resizable :ui="{ footer: 'border-t border-default' }">
        <template #header="{ collapsed }">
          <RouterLink
            :to="{ name: 'dashboard' }"
            class="flex min-w-0 items-center gap-2 rounded-md font-semibold text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <img v-if="brand.logo" :src="brand.logo" alt="" class="size-6 shrink-0" />
            <span v-if="!collapsed" class="truncate">{{ brand.name }}</span>
            <span v-else class="sr-only">{{ brand.name }}</span>
          </RouterLink>
        </template>
        <template #default="{ collapsed }">
          <nav :aria-label="t('admin.navigation')">
            <UNavigationMenu
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
          <RouterView />
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </UApp>
</template>
