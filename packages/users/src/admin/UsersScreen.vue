<script setup lang="ts">
import { useCloseGuard, useI18n, useRouter, useUnsavedChanges } from '@opulonjs/admin'
import { listDefaultPerPage, listMaxOffset } from '@opulonjs/core/api'
import { type TableQuery, UButton, UCheckbox, UForm, USlideover } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed, onBeforeUnmount, ref, shallowRef, useId } from 'vue'
import type { UserInfo } from '../api.ts'
import { failureKey, useUsersClient } from './client.ts'

interface InviteForm {
  email: string | null
  roleIds: string[]
}

const { t } = useI18n()
const router = useRouter()
const users = useUsersClient()
const list = shallowRef<{
  users: ReadonlyArray<UserInfo>
  roles: ReadonlyArray<{ id: string; name: string }>
}>()
const blank = (): InviteForm => ({ email: null, roleIds: [] })
const invite = ref<InviteForm>()
const notice = ref<{ error: boolean; text: string }>()
const busy = ref(false)
const formId = useId()

const changes = useUnsavedChanges({
  current: () => invite.value,
  saved: () => (invite.value ? blank() : undefined),
  save: () => send(),
  discard: () => (invite.value = invite.value && blank()),
  busy: () => busy.value,
  bar: false,
  within: () => document.getElementById(formId),
})
const { open, dismissible, close, leave } = useCloseGuard({
  isOpen: () => invite.value !== undefined,
  close: () => show(undefined),
  dirty: () => changes.dirty.value,
})
function show(form: InviteForm | undefined) {
  notice.value = undefined
  invite.value = form
}
async function startInvite() {
  if (await leave()) show(blank())
}

let latest = 0
onBeforeUnmount(() => latest++)
const load = async (query: TableQuery) => {
  const ticket = ++latest
  const sort = query.sort?.column
  const result = await users((client) =>
    client.users({
      query: {
        page: query.page,
        perPage: query.perPage,
        search: query.search,
        ...(sort === 'name' || sort === 'email' || sort === 'deactivated' ? { sort } : {}),
        ...(query.sort ? { direction: query.sort.direction } : {}),
      },
    }),
  )
  if (ticket === latest) list.value = result
  return { rows: result.users, total: result.total }
}

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
  { key: 'deactivated', label: t('users.users.columns.status'), sortable: true, nowrap: true },
])

function toggleRole(id: string, on: boolean | 'indeterminate') {
  if (!invite.value) return
  const ids = invite.value.roleIds.filter((x) => x !== id)
  invite.value.roleIds = on === true ? [...ids, id] : ids
}

async function send() {
  const form = invite.value
  if (!form) return
  busy.value = true
  notice.value = undefined
  const email = form.email ?? ''
  try {
    await users((client) => client.invite({ payload: { email, roleIds: [...form.roleIds] } }))
    show(undefined)
    notice.value = { error: false, text: t('users.invite.sent', { email }) }
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
          :disabled="!list"
          @click="startInvite"
        />
      </template>
    </PageHeader>
    <p
      v-if="notice && !invite"
      :role="notice.error ? 'alert' : 'status'"
      :class="notice.error ? 'text-error' : 'text-success'"
      class="text-sm"
    >
      {{ notice.text }}
    </p>
    <DataTable
      :load="load"
      :per-page="listDefaultPerPage"
      :max-page="Math.floor(listMaxOffset / listDefaultPerPage) + 1"
      :columns="columns"
      :caption="t('users.users.title')"
      :empty-title="t('users.users.empty')"
      searchable
      :on-row-click="(row: UserInfo) => router.push({ name: 'users.user', params: { id: row.id } })"
    >
      <template #pagination-limit>{{ t('users.users.paginationLimit') }}</template>
      <template #deactivated-cell="{ row }">
        <StatusBadge
          :status="row.original.deactivated ? 'disabled' : 'enabled'"
          :label="t(row.original.deactivated ? 'users.status.deactivated' : 'users.status.active')"
        />
      </template>
    </DataTable>

    <USlideover
      v-model:open="open"
      :dismissible="dismissible"
      :title="t('users.invite.title')"
      @close:prevent="close"
    >
      <template #body>
        <p
          v-if="notice"
          :role="notice.error ? 'alert' : 'status'"
          :class="notice.error ? 'text-error' : 'text-success'"
          class="mb-4 text-sm"
        >
          {{ notice.text }}
        </p>
        <UForm v-if="invite && list" :id="formId" :state="invite" class="space-y-4" @submit="send">
          <FieldText
            v-model="invite.email"
            name="email"
            type="email"
            :label="t('users.fields.email')"
            :disabled="busy"
            required
          />
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">{{ t('users.users.columns.roles') }}</legend>
            <UCheckbox
              v-for="role in list.roles"
              :key="role.id"
              :label="roleName(role.id)"
              :model-value="invite.roleIds.includes(role.id)"
              :disabled="busy"
              @update:model-value="toggleRole(role.id, $event)"
            />
          </fieldset>
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('users.invite.cancel')"
            :disabled="busy"
            @click="close"
          />
          <UButton type="submit" :form="formId" :loading="busy" :label="t('users.invite.submit')" />
        </div>
      </template>
    </USlideover>
  </section>
</template>
