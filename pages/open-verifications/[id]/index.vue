<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'open-ver-page' })

const route = useRoute()
const id = computed(() => Number(route.params.id))

const { data: level, error, refresh } = await useFetch(() => `/api/open-verifications/levels/${id.value}`, {
  watch: [id],
})

useHead(() => ({
  title: level.value ? `${level.value.name} — Open Verifications` : 'Open Verifications',
}))
</script>

<template>
  <ListPaneLayout
    columns="20% 80%"
    nav-label="Open verifications"
    :title="level?.name ?? null"
  >
    <template #nav>
      <OpenVerListNav :active-id="id" />
    </template>

    <div v-if="error" class="p-12 text-center text-zinc-500">
      <p class="text-sm">Open verification not found.</p>
      <NuxtLink to="/open-verifications" class="text-accent hover:underline text-sm mt-2 inline-block">Back to list</NuxtLink>
    </div>
    <OpenVerLevelDetail v-else-if="level" :level="level" @refresh="refresh" />
  </ListPaneLayout>
</template>
