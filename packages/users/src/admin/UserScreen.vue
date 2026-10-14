<script setup lang="ts">
/** Users > a user: roles, admin locale, deactivation and reactivation. */
import { AuditTimeline, useAdmin, useI18n, useRoute } from '@opulonjs/admin'
import { UButton, UCard, UCheckbox } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { ref, shallowRef } from 'vue'
import type { UserInfo } from '../api.ts'
import LocalePicker from './LocalePicker.vue'
import { failureKey, useUsersClient } from './client.ts'

const { t } = useI18n()
const { me, saveLocale } = useAdmin()
const id = String(useRoute().params.id)
const users = useUsersClient()
const user = shallowRef<UserInfo>()
const roles = shallowRef<ReadonlyArray<{ id: string; name: string }>>([])
const roleIds = ref<string[]>([])
const status = ref<'loading' | 'ready' | 'notFound' | 'failed'>('loading')
const notice = ref<{ error: boolean; text: string }>()
const busy = ref(false)
const confirming = ref(false)
const timeline = ref<{ refresh: () => Promise<void> }>()

let latest = 0
const load = () => {
  const ticket = ++latest
  return users((client) => client.users({ query: { id } })).then(
    (list) => {
      if (ticket !== latest) return
      user.value = list.users.find((u) => u.id === id)
      roles.value = list.roles
      roleIds.value = [...(user.value?.roleIds ?? [])]
      status.value = user.value ? 'ready' : 'notFound'
    },
    () => {
      if (ticket === latest) status.value = 'failed'
    },
  )
}
void load()

const roleName = (role: { id: string; name: string }) =>
  role.id === 'super_admin' ? t('users.roles.superAdmin') : role.name

function toggle(roleId: string, on: boolean | 'indeterminate') {
  const rest = roleIds.value.filter((x) => x !== roleId)
  roleIds.value = on === true ? [...rest, roleId] : rest
}

async function run(change: () => Promise<void>, done: string) {
  busy.value = true
  notice.value = undefined
  try {
    await change()
    notice.value = { error: false, text: t(done) }
  } catch (error) {
    notice.value = { error: true, text: t(failureKey(error)) }
  } finally {
    busy.value = false
    confirming.value = false
    await load()
    await timeline.value?.refresh()
  }
}

const saveRoles = () =>
  run(
    () => users((c) => c.assignRoles({ params: { id }, payload: { roleIds: roleIds.value } })),
    'users.user.rolesSaved',
  )

const setActive = (active: boolean) =>
  run(
    () =>
      users((c) => (active ? c.reactivate({ params: { id } }) : c.deactivate({ params: { id } }))),
    active ? 'users.user.reactivated' : 'users.user.deactivated',
  )

const localeUsers = useUsersClient({ detached: true })
const setLocale = (locale: string | null) => {
  const save = (client: typeof users) => () =>
    client((c) => c.setLocale({ params: { id }, payload: { locale } }))
  return run(
    () => (id === me.value?.user.id ? saveLocale(locale, save(localeUsers)) : save(users)()),
    'users.user.localeSaved',
  )
}
</script>

<template>
  <section class="space-y-4">
    <p v-if="status === 'failed'" role="alert" class="text-error">{{ t('users.errors.failed') }}</p>
    <p v-else-if="status === 'notFound'" role="alert">{{ t('users.user.notFound') }}</p>
    <template v-else-if="user">
      <PageHeader :title="user.name" :description="user.email">
        <template #actions>
          <StatusBadge
            :status="user.deactivated ? 'disabled' : 'enabled'"
            :label="t(user.deactivated ? 'users.status.deactivated' : 'users.status.active')"
          />
          <UButton
            v-if="user.deactivated"
            :loading="busy"
            :label="t('users.user.reactivate')"
            @click="setActive(true)"
          />
          <UButton
            v-else
            color="error"
            variant="soft"
            :label="t('users.user.deactivate')"
            @click="confirming = true"
          />
        </template>
      </PageHeader>
      <p
        v-if="notice"
        :role="notice.error ? 'alert' : 'status'"
        :class="notice.error && 'text-error'"
      >
        {{ notice.text }}
      </p>
      <p v-if="user.deactivated">{{ t('users.user.isDeactivated') }}</p>

      <UCard>
        <fieldset class="space-y-2">
          <legend class="mb-2 font-medium">{{ t('users.users.columns.roles') }}</legend>
          <UCheckbox
            v-for="role in roles"
            :key="role.id"
            :label="roleName(role)"
            :model-value="roleIds.includes(role.id)"
            @update:model-value="toggle(role.id, $event)"
          />
        </fieldset>
        <UButton
          class="mt-4"
          :loading="busy"
          :label="t('users.user.saveRoles')"
          @click="saveRoles"
        />
      </UCard>

      <UCard>
        <LocalePicker
          :label="t('users.account.locale')"
          :model-value="user.locale"
          :disabled="busy"
          @update:model-value="setLocale"
        />
      </UCard>

      <AuditTimeline ref="timeline" subject-type="user" :subject-id="id" />
      <ConfirmDialog
        v-model:open="confirming"
        :title="t('users.user.confirmTitle')"
        :description="t('users.user.confirmText', { name: user.name })"
        :confirm-label="t('users.user.confirm')"
        :loading="busy"
        danger
        @confirm="setActive(false)"
      />
    </template>
  </section>
</template>
