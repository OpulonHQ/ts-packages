<script setup lang="ts">
import { useCmsClient } from '@opulonjs/cms/site/nuxt'

const url = useRequestURL()
// `/plain` reads public cms content but greets the visitor by a cookie, and does not opt in to
// public caching: it must never be cached for others.
const plain = url.pathname === '/plain'
const name = useCookie('name')
const cms = useCmsClient()
const { data: site } = await useAsyncData('plain-site', () =>
  plain ? cms.site() : Promise.resolve(null),
)
</script>

<template>
  <header>Fixture site</header>
  <p v-if="plain">Hello {{ name ?? 'guest' }} ({{ site?.locale }})</p>
  <CmsPage v-else :path="url.pathname" :preview="url.searchParams.get('preview')" />
</template>
