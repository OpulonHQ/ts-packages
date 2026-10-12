<script setup lang="ts">
import {
  type NavigationMenuItem,
  nuxtUiEn,
  nuxtUiSk,
  UAlert,
  UApp,
  UDashboardGroup,
  UDashboardNavbar,
  UDashboardPanel,
  UDashboardSidebar,
  UDashboardSidebarCollapse,
  UNavigationMenu,
} from '@opulonjs/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAdmin } from '../state.ts'

const { brand, me, status, stale, nav } = useAdmin()
const { t, locale } = useI18n()
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
          { label: t('admin.reload.action'), color: 'neutral', variant: 'solid', onClick: reload },
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
          <div v-if="me" class="flex min-w-0 items-center gap-2 text-sm">
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated font-medium text-highlighted"
              aria-hidden="true"
            >
              {{ me.user.name.charAt(0) }}
            </span>
            <span v-if="!collapsed" class="min-w-0">
              <span class="block truncate font-medium text-highlighted">{{ me.user.name }}</span>
              <span class="block truncate text-xs text-muted">{{ me.user.email }}</span>
            </span>
          </div>
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
