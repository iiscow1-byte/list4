<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'open-ver-page' })

const route = useRoute()
const id = computed(() => Number(route.params.id))

const { data: level, error } = await useFetch(() => `/api/open-verifications/levels/${id.value}`, {
  watch: [id],
})

useHead(() => ({
  title: level.value ? `${level.value.name} — Open Verifications` : 'Open Verifications',
}))
</script>

<template>
  <div class="grid grid-cols-[20%_80%] grid-rows-[minmax(0,1fr)] h-full">
    <OpenVerListNav :active-id="id" />
    <section class="overflow-y-auto min-h-0">
      <div v-if="error" class="p-12 text-center text-zinc-500">
        <p class="text-sm">Open verification not found.</p>
        <NuxtLink to="/open-verifications" class="text-accent hover:underline text-sm mt-2 inline-block">Back to list</NuxtLink>
      </div>
      <OpenVerLevelDetail v-else-if="level" :level="level" />
    </section>
  </div>
</template>
