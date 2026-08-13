<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'void-page' })

const route = useRoute()
const position = computed(() => Number(route.params.position))

const { data: level, error, refresh } = await useFetch(() => `/api/void/levels/${position.value}`, {
  watch: [position],
})

useHead(() => ({
  title: level.value ? `#${level.value.position} ${level.value.name} — Void List` : 'Void List',
}))
</script>

<template>
  <ListPaneLayout
    columns="20% 80%"
    nav-label="Void list"
    :title="level ? `#${level.position} ${level.name}` : null"
  >
    <template #nav>
      <VoidListNav :active-position="position" />
    </template>

    <div v-if="error" class="p-12 text-center text-zinc-500">
      <p class="text-sm">Void level #{{ position }} not found.</p>
      <NuxtLink to="/void/1" class="text-accent hover:underline text-sm mt-2 inline-block">Back to top</NuxtLink>
    </div>
    <VoidLevelDetail v-else-if="level" :level="level" @refresh="refresh" />
  </ListPaneLayout>
</template>
