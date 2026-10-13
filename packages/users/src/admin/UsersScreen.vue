<script setup lang="ts">
/** Users > Users: every staff user with roles and status, and the invitation form. */
import { useI18n, useRouter } from '@opulonjs/admin'
import { UButton, UCard, UCheckbox, UForm } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed, ref, shallowRef } from 'vue'
import type { UserInfo } from '../api.ts'
import { failureKey, useUsersClient } from './client.ts'

const { t } = useI18n()
const router = useRouter()
const users = useUsersClient()
const list = shallowRef<{
  users: ReadonlyArray<UserInfo>
  roles: ReadonlyArray<{ id: string; name: string }>
}>()
const failed = ref(false)
const inviting = ref(false)
const invite = ref({ email: null as string | null, roleIds: [] as string[] })
const notice = ref<{ error: boolean; text: string }>()
const busy = ref(false)

const load = () =>
  users((client) => client.users()).then(
    (result) => (list.value = result),
    () => (failed.value = true),
  )
void load()

const roleName = (id: string) =>
  id === 'super_admin'
    ? t('users.roles.superAdmin')
    : (list.value?.roles.find((r) => r.id === id)?.name ?? id)

const columns = computed(() => [
  { key: 'name', label: t('users.users.columns.name'), sortable: true },
  { key: 'email', label: t('users.users.columns.email'), sortable: true },
  {
    key: 'roleIds',
    label: t('users.users.columns.roles'),
    format: (value: unknown) => (value as ReadonlyArray<string>).map(roleName).join(', '),
  },
  { key: 'deactivated', label: t('users.users.columns.status') },
])

function toggleRole(id: string, on: boolean | 'indeterminate') {
  const ids = invite.value.roleIds.filter((x) => x !== id)
  invite.value.roleIds = on === true ? [...ids, id] : ids
}

async function send() {
  busy.value = true
  notice.value = undefined
  const email = invite.value.email ?? ''
  try {
    await users((client) => client.invite({ payload: { email, roleIds: invite.value.roleIds } }))
    notice.value = { error: false, text: t('users.invite.sent', { email }) }
    invite.value = { email: null, roleIds: [] }
  } catch (error) {
    const tag = (error as { _tag?: string } | undefined)?._tag
    notice.value = {
      error: true,
      text: t(
        tag === 'Conflict'
          ? 'users.invite.taken'
          : tag === 'BadRequest'
            ? 'users.invite.invalid'
            : failureKey(error),
      ),
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <PageHeader :title="t('users.users.title')" :description="t('users.users.description')">
      <template #actions>
        <UButton
          icon="i-lucide-user-plus"
          :label="t('users.invite.open')"
          @click="inviting = !inviting"
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
    <UCard v-if="inviting && list">
      <UForm :state="invite" class="space-y-4" @submit="send">
        <FieldText
          v-model="invite.email"
          name="email"
          type="email"
          :label="t('users.fields.email')"
          required
        />
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ t('users.users.columns.roles') }}</legend>
          <UCheckbox
            v-for="role in list.roles"
            :key="role.id"
            :label="roleName(role.id)"
            :model-value="invite.roleIds.includes(role.id)"
            @update:model-value="toggleRole(role.id, $event)"
          />
        </fieldset>
        <UButton type="submit" :loading="busy" :label="t('users.invite.submit')" />
      </UForm>
    </UCard>
    <p v-if="failed" role="alert" class="text-error">{{ t('users.errors.failed') }}</p>
    <DataTable
      v-else-if="list"
      :rows="list.users"
      :columns="columns"
      :caption="t('users.users.title')"
      :empty-title="t('users.users.empty')"
      searchable
      :on-row-click="(row: UserInfo) => router.push({ name: 'users.user', params: { id: row.id } })"
    >
      <template #deactivated-cell="{ row }">
        <StatusBadge
          :status="row.original.deactivated ? 'disabled' : 'enabled'"
          :label="t(row.original.deactivated ? 'users.status.deactivated' : 'users.status.active')"
        />
      </template>
    </DataTable>
  </section>
</template>
