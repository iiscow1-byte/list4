<script setup lang="ts">
/**
 * `/lists/:id` opens the list at its top level, mirroring how `/` opens the
 * main list at #1. An empty list has nothing to open, so it shows a stub with
 * a way into the builder instead.
 */
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, error, canEdit, base, pendingCount, liked, toggleLike } = useCustomList(publicId)

if (list.value?.items?.length) {
  await navigateTo(`${base.value}/1`, { replace: true })
}

useHead(() => ({ title: list.value?.title ?? 'List' }))
</script>

<template>
  <div v-if="error" class="h-full flex items-center justify-center">
    <div class="text-center">
      <p class="text-sm text-zinc-500">This list doesn't exist.</p>
      <NuxtLink to="/lists" class="text-accent hover:underline text-sm mt-2 inline-block">Browse public lists →</NuxtLink>
    </div>
  </div>

  <div v-else-if="list" class="h-full flex flex-col min-h-0">
    <CustomListBar
      :list="list"
      :can-edit="canEdit"
      :pending-count="pendingCount"
      :liked="liked"
      @like="toggleLike"
    />
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center px-6">
        <p class="text-sm text-zinc-400">This list has no levels yet.</p>
        <NuxtLink
          v-if="canEdit"
          to="/builder"
          class="inline-block mt-3 rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
        >Add levels in the builder →</NuxtLink>
      </div>
    </div>
  </div>
</template>
