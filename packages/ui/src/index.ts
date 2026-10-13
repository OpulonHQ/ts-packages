// @opulonjs/ui: the admin UI kit on Nuxt UI 4. Kit components live at their canonical
// specifier `@opulonjs/ui/components/<Name>` (e.g. `@opulonjs/ui/components/DataTable`,
// `@opulonjs/ui/components/Field/Text`). `@nuxt/ui` may only be imported inside this package,
// so the Nuxt UI pieces admin screens use are re-exported here.
export const packageName = '@opulonjs/ui'

export { uiPlugin } from './plugin.ts'
export type { Brand } from './vite.ts'
export { en as nuxtUiEn, sk as nuxtUiSk } from '@nuxt/ui/locale'
export { useOverlay, useToast } from '@nuxt/ui/composables'
export type {
  BreadcrumbItem,
  DropdownMenuItem,
  NavigationMenuItem,
  TableColumn,
  TabsItem,
} from '@nuxt/ui'

export { default as UAlert } from '@nuxt/ui/components/Alert.vue'
export { default as UApp } from '@nuxt/ui/components/App.vue'
export { default as UAvatar } from '@nuxt/ui/components/Avatar.vue'
export { default as UBadge } from '@nuxt/ui/components/Badge.vue'
export { default as UButton } from '@nuxt/ui/components/Button.vue'
export { default as UCard } from '@nuxt/ui/components/Card.vue'
export { default as UCheckbox } from '@nuxt/ui/components/Checkbox.vue'
export { default as UDashboardGroup } from '@nuxt/ui/components/DashboardGroup.vue'
export { default as UDashboardNavbar } from '@nuxt/ui/components/DashboardNavbar.vue'
export { default as UDashboardPanel } from '@nuxt/ui/components/DashboardPanel.vue'
export { default as UDashboardSidebar } from '@nuxt/ui/components/DashboardSidebar.vue'
export { default as UDashboardSidebarCollapse } from '@nuxt/ui/components/DashboardSidebarCollapse.vue'
export { default as UDashboardToolbar } from '@nuxt/ui/components/DashboardToolbar.vue'
export { default as UDropdownMenu } from '@nuxt/ui/components/DropdownMenu.vue'
export { default as UForm } from '@nuxt/ui/components/Form.vue'
export { default as UFormField } from '@nuxt/ui/components/FormField.vue'
export { default as UIcon } from '@nuxt/ui/components/Icon.vue'
export { default as UInput } from '@nuxt/ui/components/Input.vue'
export { default as ULink } from '@nuxt/ui/components/Link.vue'
export { default as UModal } from '@nuxt/ui/components/Modal.vue'
export { default as UNavigationMenu } from '@nuxt/ui/components/NavigationMenu.vue'
export { default as USelectMenu } from '@nuxt/ui/components/SelectMenu.vue'
export { default as USeparator } from '@nuxt/ui/components/Separator.vue'
export { default as USkeleton } from '@nuxt/ui/components/Skeleton.vue'
export { default as USlideover } from '@nuxt/ui/components/Slideover.vue'
export { default as USwitch } from '@nuxt/ui/components/Switch.vue'
export { default as UTabs } from '@nuxt/ui/components/Tabs.vue'
export { default as UTextarea } from '@nuxt/ui/components/Textarea.vue'
export { default as UTooltip } from '@nuxt/ui/components/Tooltip.vue'

export { defaultRichTextToolbar } from './fields.ts'
export type { FieldProps, RichTextButton, SelectItem } from './fields.ts'
export { EMPTY_PLACEHOLDER, humanize, languageName, statusColor } from './format.ts'
export type { BadgeColor } from './format.ts'
export { nextSort, queryRows } from './table.ts'
export type {
  DataTableColumn,
  DataTableFilter,
  SortDirection,
  SortState,
  TablePage,
  TableQuery,
} from './table.ts'
