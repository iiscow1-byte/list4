<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const position = computed(() => Number(route.params.position))

const { data: level, error, refresh } = await useFetch(() => `/api/levels/${position.value}`, {
  watch: [position],
})

useHead(() => ({
  title: level.value ? `#${level.value.position} ${level.value.name} — All Levels List` : 'All Levels List',
}))
</script>

<template>
  <div class="grid grid-cols-[20%_60%_20%] grid-rows-[minmax(0,1fr)] h-full">
    <LevelListNav :active-position="position" />
    <section class="overflow-y-auto min-h-0">
      <div v-if="error" class="p-12 text-center text-zinc-500">
        <p class="text-sm">Level #{{ position }} not found.</p>
        <NuxtLink to="/levels/1" class="text-accent hover:underline text-sm mt-2 inline-block">Back to top of list</NuxtLink>
      </div>
      <LevelDetail v-else-if="level" :level="level" @refresh="refresh" />
    </section>
    <LevelRecords :records="level?.records ?? []" />
  </div>
</template>
