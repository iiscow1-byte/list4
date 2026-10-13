<script setup lang="ts">
/**
 * The challenge list's own address: opens its #1 with the list showing
 * challenges, and the list open on a phone.
 */
const { data } = await useFetch<{ items: { position: number }[] }>('/api/levels', {
  query: { ratings: 'Challenge', rankByFilter: 1, pageSize: 1, fields: 'nav' },
})
const first = data.value?.items[0]?.position
useState('reveal-level-list', () => false).value = true
await navigateTo(first ? `/levels/${first}?list=challenge` : '/levels/1', { replace: true, redirectCode: 302 })
</script>

<template>
  <div />
</template>
