<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'awaiting-index' })

const { data } = await useFetch<{ items: { id: number }[] }>('/api/awaiting/levels', {
  query: { page: 1, pageSize: 1 },
})
const firstId = computed(() => data.value?.items?.[0]?.id ?? null)

useHead(() => ({ title: 'Awaiting Placement' }))
</script>

<template>
  <ListPaneLayout columns="20% 80%" nav-label="Awaiting">
    <template #nav>
      <AwaitingListNav :active-id="null" />
    </template>

    <div class="px-4 py-10 sm:p-12 max-w-2xl mx-auto text-center">
      <h1 class="text-xl sm:text-2xl font-semibold tracking-tight mb-2">Awaiting placement</h1>
      <p class="text-sm text-zinc-400 mb-6">
        Levels approved out of pending review that haven't been given a final position yet.
      </p>
      <NuxtLink
        v-if="firstId"
        :to="`/awaiting/${firstId}`"
        class="btn btn-md btn-primary"
      >View first level</NuxtLink>
      <p v-else class="text-xs text-zinc-500">Nothing here right now.</p>
    </div>
  </ListPaneLayout>
</template>
