<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'void-page' })

const route = useRoute()
const position = computed(() => Number(route.params.position))

const { data: level, error } = await useFetch(() => `/api/void/levels/${position.value}`, {
  watch: [position],
})

useHead(() => ({
  title: level.value ? `#${level.value.position} ${level.value.name} — Void List` : 'Void List',
}))
</script>

<template>
  <div class="grid grid-cols-[20%_80%] grid-rows-[minmax(0,1fr)] h-full">
    <VoidListNav :active-position="position" />
    <section class="overflow-y-auto min-h-0">
      <div v-if="error" class="p-12 text-center text-zinc-500">
        <p class="text-sm">Void level #{{ position }} not found.</p>
        <NuxtLink to="/void/1" class="text-accent hover:underline text-sm mt-2 inline-block">Back to top</NuxtLink>
      </div>
      <VoidLevelDetail v-else-if="level" :level="level" />
    </section>
  </div>
</template>
