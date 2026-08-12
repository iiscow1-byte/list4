<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'open-ver-index' })

const { data } = await useFetch<{ items: { id: number }[] }>('/api/open-verifications/levels', {
  query: { page: 1, pageSize: 1 },
})
const firstId = computed(() => data.value?.items?.[0]?.id ?? null)

useHead(() => ({ title: 'Open Verifications' }))
</script>

<template>
  <div class="grid grid-cols-[20%_80%] grid-rows-[minmax(0,1fr)] h-full">
    <OpenVerListNav :active-id="null" />
    <section class="overflow-y-auto min-h-0">
      <div class="p-12 max-w-2xl mx-auto text-center">
        <h1 class="text-2xl font-semibold tracking-tight mb-2">Open verifications</h1>
        <p class="text-sm text-zinc-400 mb-6">
          Levels submitted by the community that have not yet been verified.
          Showcase clips appear in place of a verification video.
        </p>
        <NuxtLink
          v-if="firstId"
          :to="`/open-verifications/${firstId}`"
          class="btn btn-md btn-primary"
        >View first level</NuxtLink>
        <p v-else class="text-xs text-zinc-500">Nothing here right now.</p>
      </div>
    </section>
  </div>
</template>
