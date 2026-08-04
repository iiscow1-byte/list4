<script setup lang="ts">
import { marksOffAll } from '~/utils/custom-list-colors'

/**
 * A custom list, as a full list site: nav on the left, the selected level in
 * the middle, its records on the right — the same three-panel shape the main
 * ALL list uses.
 */
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const {
  list, error, refresh, canEdit, base, editors,
  pendingCount, suggestionCount, liked, toggleLike,
} = useCustomList(publicId)
const { standalone, to } = useStandaloneList()

/**
 * The list's own accent, applied to the whole list root.
 *
 * `accent_color` has been storable since 1.3 and only ever tinted the fallback
 * icon. Tailwind's `accent` resolves through `--c-accent`, so setting that one
 * variable on this element re-themes every `text-accent` / `bg-accent` inside
 * it — tabs, rank numbers, links — and nothing outside it.
 */
const accentStyle = computed(() => {
  const hex = list.value?.accent_color
  const m = typeof hex === 'string' ? hex.match(/^#([0-9a-f]{6})$/i) : null
  if (!m) return undefined
  const n = parseInt(m[1]!, 16)
  return { '--c-accent': `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}` }
})

/** Presentation flags, defaulting to what the list looked like before they existed. */
const on = (v: unknown) => v == null || !!v
const showBanner = computed(() => on(list.value?.show_banner) && !!list.value?.banner_url)
const showEditors = computed(() => on(list.value?.show_editors) && editors.value.length > 0)

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
  if (e.key === 'ArrowLeft' && rank.value > 1) navigateTo(to(`${base.value}/${rank.value - 1}`))
  if (e.key === 'ArrowRight' && rank.value < list.value.items.length) navigateTo(to(`${base.value}/${rank.value + 1}`))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
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
    <!-- The list's own banner. Storable since 1.3 and never rendered until
         now; kept short so it frames the list rather than replacing it. -->
    <div v-if="showBanner" class="relative shrink-0 h-20 sm:h-28 overflow-hidden border-b border-zinc-800/80">
      <img :src="list.banner_url!" alt="" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
      <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" aria-hidden="true" />
    </div>

    <CustomListBar
      :list="list"
      :staff="editors"
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
        :follow-all-order="!!list.follow_all_order"
        :mark-off-all="marksOffAll(list)"
        :show-thumbnails="on(list.show_thumbnails)"
        :show-points="on(list.show_points)"
        :show-records="on(list.show_records)"
        :compact="!!list.compact_rows"
        :tiers="list.tiers ?? []"
        class="hidden md:flex"
        @changed="refresh"
      />
      <CustomListLevelDetail
        :item="activeItem"
        :items="list.items"
        :list-title="list.title"
        :total-items="list.items.length"
        :list-path="base"
        :can-edit="canEdit"
        :api-base="`/api/custom-lists/${publicId}`"
        :follow-all-order="!!list.follow_all_order"
        :mark-off-all="marksOffAll(list)"
        @changed="refresh"
      />
      <!-- Right column: this level's records, and who runs the list under
           them — the place a reader looks for both. -->
      <aside class="hidden xl:flex flex-col min-h-0 border-l border-zinc-800/80 bg-zinc-950">
        <CustomListRecords
          :item="activeItem"
          :accepts-records="!!list.accepts_records"
          :can-moderate="canEdit"
          :api-base="`/api/custom-lists/${publicId}`"
          :page-base="base"
          class="flex-1 min-h-0 !border-l-0"
          @deleted="refresh"
        />
        <div v-if="showEditors" class="shrink-0 border-t border-zinc-800/80 p-3 max-h-56 overflow-y-auto">
          <p class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-1.5 px-3">
            List editors
          </p>
          <CustomListStaff :staff="editors" variant="compact" />
        </div>
      </aside>
    </div>
  </div>
</template>
