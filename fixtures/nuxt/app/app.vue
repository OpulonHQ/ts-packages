<script setup lang="ts">
const url = useRequestURL()
// `/plain` reads no cms and greets the visitor by a cookie: must never be cached for others.
const name = useCookie('name')
</script>

<template>
  <header>Fixture site</header>
  <p v-if="url.pathname === '/plain'">Hello {{ name ?? 'guest' }}</p>
  <CmsPage v-else :path="url.pathname" :preview="url.searchParams.get('preview')" />
</template>
