<script setup lang="ts">
import type { AuditEvent } from '@opulonjs/core/api'
import { useI18n } from 'vue-i18n'

defineProps<{ event: AuditEvent }>()
const { t, te, locale } = useI18n()
const value = (input: unknown) =>
  input === null || input === undefined
    ? '—'
    : typeof input === 'string'
      ? input
      : JSON.stringify(input)
</script>

<template>
  <article class="space-y-2 whitespace-normal break-words">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <strong>{{ te(`audit.${event.action}`) ? t(`audit.${event.action}`) : event.action }}</strong>
      <time :datetime="event.occurredAt" class="text-sm text-muted">
        {{
          new Date(event.occurredAt).toLocaleString(locale, {
            timeZone: 'UTC',
            timeZoneName: 'short',
          })
        }}
      </time>
    </div>
    <p class="text-sm">
      {{ event.actor.name ?? t(`admin.audit.actors.${event.actor.kind}`) }}
      <span class="text-muted"
        >({{ t(`admin.audit.actors.${event.actor.kind}`)
        }}<template v-if="event.actor.id"> · {{ event.actor.id }}</template
        >)</span
      >
    </p>
    <p v-if="event.subject.type || event.subject.id || event.subject.label" class="text-sm">
      <span class="font-medium">{{
        event.subject.label ?? event.subject.id ?? event.subject.type
      }}</span>
      <span class="text-muted">
        · {{ event.subject.type
        }}<template v-if="event.subject.id"> · {{ event.subject.id }}</template></span
      >
    </p>
    <p class="text-xs text-muted">{{ event.action }}</p>
    <dl v-if="event.changes.length" class="space-y-1 text-sm">
      <div v-for="(change, index) in event.changes" :key="index" class="flex flex-wrap gap-x-2">
        <dt class="font-medium">{{ change.field }}</dt>
        <dd class="flex flex-wrap gap-x-2">
          <span>{{ t('admin.audit.from') }} {{ value(change.from) }}</span>
          <span>{{ t('admin.audit.to') }} {{ value(change.to) }}</span>
        </dd>
      </div>
    </dl>
    <dl v-if="event.ip !== null || event.userAgent !== null" class="space-y-1 text-xs text-muted">
      <div v-if="event.ip !== null" class="flex flex-wrap gap-x-2">
        <dt>{{ t('admin.audit.ip') }}</dt>
        <dd>{{ event.ip }}</dd>
      </div>
      <div v-if="event.userAgent !== null" class="flex flex-wrap gap-x-2">
        <dt>{{ t('admin.audit.userAgent') }}</dt>
        <dd>{{ event.userAgent }}</dd>
      </div>
    </dl>
  </article>
</template>
