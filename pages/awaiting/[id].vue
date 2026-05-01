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
  <div class="grid grid-cols-[20%_80%] grid-rows-[minmax(0,1fr)] h-full">
    <AwaitingListNav :active-id="id" />
    <section class="overflow-y-auto min-h-0">
      <div v-if="error" class="p-12 text-center text-zinc-500">
        <p class="text-sm">Awaiting level not found.</p>
        <NuxtLink to="/awaiting" class="text-accent hover:underline text-sm mt-2 inline-block">Back to list</NuxtLink>
      </div>
      <AwaitingLevelDetail v-else-if="level" :level="level" />
    </section>
  </div>
</template>
