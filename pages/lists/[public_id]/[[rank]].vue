<script setup lang="ts">
/**
 * A custom list, as a full list site: nav on the left, the selected level in
 * the middle, its records on the right — the same three-panel shape the main
 * ALL list uses.
 */
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, error, refresh, canEdit, base, pendingCount, suggestionCount, liked, toggleLike } = useCustomList(publicId)

/**
 * `rank` is optional: `/lists/:id` opens the list at its top level and
 * `/lists/:id/7` at #7. Handling both here rather than redirecting from a
 * separate index page means there's no moment where the route has resolved
 * but the list hasn't — the redirect version rendered "no levels yet" because
 * it made that decision during setup, before the fetch came back.
 */
const rank = computed(() => {
  const n = Number(route.params.rank)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const activeItem = computed(() => {
  const items = list.value?.items ?? []
  return items.find((i: any) => i.rank === rank.value) ?? items[0] ?? null
})

useHead(() => ({
  title: activeItem.value && list.value
    ? `#${activeItem.value.rank} ${activeItem.value.name} — ${list.value.title}`
    : (list.value?.title ?? 'List'),
}))

// Left/right arrows step through the list, matching the main list page.
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (!list.value?.items.length) return
  if (e.key === 'ArrowLeft' && rank.value > 1) navigateTo(`${base.value}/${rank.value - 1}`)
  if (e.key === 'ArrowRight' && rank.value < list.value.items.length) navigateTo(`${base.value}/${rank.value + 1}`)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="error" class="h-full flex items-center justify-center">
    <div class="text-center">
      <p class="text-sm text-zinc-500">This list doesn't exist.</p>
      <NuxtLink to="/lists" class="text-accent hover:underline text-sm mt-2 inline-block">Browse public lists →</NuxtLink>
    </div>
  </div>

  <div v-else-if="list" data-list-root class="h-full flex flex-col min-h-0 bg-zinc-950">
    <CustomListBar
      :list="list"
      :can-edit="canEdit"
      :pending-count="pendingCount"
      :suggestion-count="suggestionCount"
      :liked="liked"
      @like="toggleLike"
    />
    <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_17rem]">
      <CustomListNav
        :items="list.items"
        :active-id="activeItem?.id ?? null"
        :list-path="base"
        :can-edit="canEdit"
        :api-base="`/api/custom-lists/${publicId}`"
        class="hidden md:flex"
        @changed="refresh"
      />
      <CustomListLevelDetail
        :item="activeItem"
        :list-title="list.title"
        :total-items="list.items.length"
        :list-path="base"
        :can-edit="canEdit"
        :api-base="`/api/custom-lists/${publicId}`"
        @changed="refresh"
      />
      <CustomListRecords
        :item="activeItem"
        :accepts-records="!!list.accepts_records"
        :can-moderate="canEdit"
        :api-base="`/api/custom-lists/${publicId}`"
        :page-base="base"
        class="hidden xl:flex"
        @deleted="refresh"
      />
    </div>
  </div>
</template>
