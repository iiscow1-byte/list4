<script setup lang="ts">
/**
 * Chrome shared by a custom list's secondary pages (leaderboard, packs,
 * submit, queue, settings): the list bar, a scrolling body, and the
 * not-found / loading states. Keeps those pages down to their own content.
 */
import { listAccentStyle } from '~/utils/custom-list-colors'

const props = defineProps<{
  publicId: string
  /** Constrains the content column; the list view opts out with its own grid. */
  width?: 'narrow' | 'wide'
  title?: string
}>()

const { list, error, canEdit, editors, pendingCount, suggestionCount, liked, toggleLike } = useCustomList(() => props.publicId)
const { standalone } = useStandaloneList()

/** The list's colour, on every one of its pages rather than just the first. */
const accentStyle = computed(() => listAccentStyle(list.value))
</script>

<template>
  <div v-if="error" class="h-full flex items-center justify-center">
    <div class="text-center">
      <p class="text-sm text-zinc-500">This list doesn't exist.</p>
      <NuxtLink v-if="!standalone" to="/lists" class="text-accent hover:underline text-sm mt-2 inline-block">Browse custom lists →</NuxtLink>
      <NuxtLink v-else to="/" class="text-accent hover:underline text-sm mt-2 inline-block">Go to the All Levels List →</NuxtLink>
    </div>
  </div>

  <div v-else-if="list" data-list-root class="h-full flex flex-col min-h-0 bg-zinc-950" :style="accentStyle">
    <!-- The roster travels with the bar. Without it the Editors button existed
         on the list view and vanished on every other tab, which reads as the
         list having lost its staff rather than the page having forgotten to
         pass them. -->
    <CustomListBar
      :list="list"
      :staff="editors"
      :can-edit="canEdit"
      :pending-count="pendingCount"
      :suggestion-count="suggestionCount"
      :liked="liked"
      @like="toggleLike"
    />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div
        class="mx-auto px-4 sm:px-6 py-6"
        :class="width === 'wide' ? 'max-w-5xl' : 'max-w-3xl'"
      >
        <h2 v-if="title" class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-3">{{ title }}</h2>
        <slot :list="list" :can-edit="canEdit" />
      </div>
    </div>
  </div>

  <div v-else class="h-full flex items-center justify-center">
    <p class="text-sm text-zinc-600">Loading…</p>
  </div>
</template>
