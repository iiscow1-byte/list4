<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'awaiting-page' })

const route = useRoute()
const id = computed(() => Number(route.params.id))

const { data: level, error } = await useFetch(() => `/api/awaiting/levels/${id.value}`, {
  watch: [id],
})

useHead(() => ({
  title: level.value ? `${level.value.name} — Awaiting Placement` : 'Awaiting Placement',
}))
</script>

<template>
  <ListPaneLayout
    columns="20% 80%"
    nav-label="Awaiting"
    :title="level?.name ?? null"
  >
    <template #nav>
      <AwaitingListNav :active-id="id" />
    </template>

    <div v-if="error" class="p-12 text-center text-zinc-500">
      <p class="text-sm">Awaiting level not found.</p>
      <NuxtLink to="/awaiting" class="text-accent hover:underline text-sm mt-2 inline-block">Back to list</NuxtLink>
    </div>
    <AwaitingLevelDetail v-else-if="level" :level="level" />
    <div v-else class="p-12 text-center text-zinc-500">
      <p class="text-sm">Loading…</p>
    </div>
  </ListPaneLayout>
</template>
