<script setup lang="ts">
const url = useRequestURL()
</script>

<template>
  <header>Fixture site</header>
  <CmsPage :path="url.pathname" :preview="url.searchParams.get('preview')" />
</template>
