<script setup lang="ts">
/** Users > Roles: roles with their permissions, created and edited from the composed catalog. */
import { useAdmin, useI18n } from '@opulonjs/admin'
import { humanize, UButton, UCard, UCheckbox, UForm } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed, ref, shallowRef } from 'vue'
import type { RoleInfo } from '../api.ts'
import { failureKey, useUsersClient } from './client.ts'

const { t } = useI18n()
const { me } = useAdmin()
const users = useUsersClient()
const roles = shallowRef<ReadonlyArray<RoleInfo>>()
const failed = ref(false)
/** The role being created (no id) or edited. */
const editing = ref<{ id?: string; name: string | null; permissions: string[] }>()
const notice = ref<{ error: boolean; text: string }>()
const busy = ref(false)

const load = () =>
  users((client) => client.roles()).then(
    (result) => (roles.value = result.roles),
    () => (failed.value = true),
  )
void load()

const label = (key: string) => t(`permissions.${key}`)
const name = (role: RoleInfo) => (role.builtIn ? t('users.roles.superAdmin') : role.name)

/** The composed catalog grouped by module id, in catalog order. */
const groups = computed(() => {
  const byModule = new Map<string, string[]>()
  for (const key of me.value?.permissionCatalog ?? []) {
    const id = key.split('.')[0]!
    byModule.set(id, [...(byModule.get(id) ?? []), key])
  }
  return [...byModule].map(([id, keys]) => ({ id, keys }))
})

const columns = computed(() => [
  { key: 'name', label: t('users.roles.columns.name'), sortable: true },
  { key: 'permissions', label: t('users.roles.columns.permissions') },
  { key: 'holders', label: t('users.roles.columns.holders') },
])

function edit(role?: RoleInfo) {
  notice.value = undefined
  if (role?.builtIn) {
    notice.value = { error: false, text: t('users.roles.builtIn') }
    editing.value = undefined
    return
  }
  editing.value = role
    ? { id: role.id, name: role.name, permissions: [...role.permissions] }
    : { name: null, permissions: [] }
}

function toggle(key: string, on: boolean | 'indeterminate') {
  if (!editing.value) return
  const rest = editing.value.permissions.filter((k) => k !== key)
  editing.value.permissions = on === true ? [...rest, key] : rest
}

async function save() {
  const role = editing.value
  if (!role) return
  busy.value = true
  notice.value = undefined
  // Stored keys no composed module declares are kept by the server; send only catalog keys.
  const catalog = me.value?.permissionCatalog ?? []
  const payload = {
    name: (role.name ?? '').trim(),
    permissions: role.permissions.filter((k) => catalog.includes(k)),
  }
  try {
    if (role.id) {
      const id = role.id
      await users((c) => c.updateRole({ params: { id }, payload }))
    } else await users((c) => c.createRole({ payload }))
    notice.value = { error: false, text: t('users.roles.saved') }
    editing.value = undefined
    await load()
  } catch (error) {
    const tag = (error as { _tag?: string } | undefined)?._tag
    notice.value = {
      error: true,
      text: t(tag === 'Conflict' ? 'users.roles.nameTaken' : failureKey(error)),
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <PageHeader :title="t('users.roles.title')" :description="t('users.roles.description')">
      <template #actions>
        <UButton icon="i-lucide-plus" :label="t('users.roles.new')" @click="edit()" />
      </template>
    </PageHeader>
    <p
      v-if="notice"
      :role="notice.error ? 'alert' : 'status'"
      :class="notice.error && 'text-error'"
    >
      {{ notice.text }}
    </p>
    <UCard v-if="editing">
      <UForm :state="editing" class="space-y-4" @submit="save">
        <FieldText
          v-model="editing.name"
          name="name"
          :label="t('users.roles.columns.name')"
          required
        />
        <fieldset v-for="group in groups" :key="group.id" class="space-y-2">
          <legend class="font-medium">{{ humanize(group.id) }}</legend>
          <UCheckbox
            v-for="key in group.keys"
            :key="key"
            :label="label(key)"
            :model-value="editing.permissions.includes(key)"
            @update:model-value="toggle(key, $event)"
          />
        </fieldset>
        <div class="flex gap-2">
          <UButton type="submit" :loading="busy" :label="t('users.roles.save')" />
          <UButton variant="ghost" :label="t('users.roles.cancel')" @click="editing = undefined" />
        </div>
      </UForm>
    </UCard>
    <p v-if="failed" role="alert" class="text-error">{{ t('users.errors.failed') }}</p>
    <DataTable
      v-else-if="roles"
      :rows="roles"
      :columns="columns"
      :caption="t('users.roles.title')"
      :empty-title="t('users.roles.empty')"
      :on-row-click="edit"
    >
      <template #name-cell="{ row }">{{ name(row.original) }}</template>
      <template #permissions-cell="{ row }">
        {{
          row.original.builtIn
            ? t('users.roles.everything')
            : row.original.permissions
                .filter((k) => me?.permissionCatalog.includes(k))
                .map(label)
                .join(', ')
        }}
      </template>
    </DataTable>
  </section>
</template>
