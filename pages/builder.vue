<script setup lang="ts">
/**
 * The page around the list builder. The builder is the page, so the frame is
 * a title, one line, and the way back to your saved lists.
 */
type Stats = { totalLevels: number }

const { data: stats } = await useFetch<Stats>('/api/stats', {
  pick: ['totalLevels'],
})

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

useHead({ title: 'Build a list — All Levels List' })
</script>

<template>
  <div class="container-wide py-8">
    <header class="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <h1 class="page-title">Build a list</h1>
        <p class="page-lead max-w-2xl">
          Pick levels from the ALL or add your own, put them in your order, then save and share it.
          <template v-if="stats">{{ stats.totalLevels.toLocaleString() }} levels to choose from.</template>
        </p>
      </div>
      <nav class="flex flex-wrap items-center gap-2 shrink-0">
        <NuxtLink v-if="me" to="/lists?view=mine" class="btn btn-sm btn-ghost">Your lists</NuxtLink>
        <NuxtLink to="/lists" class="btn btn-sm btn-ghost">Browse lists</NuxtLink>
      </nav>
    </header>

    <ListBuilder />
  </div>
</template>
