<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * Left panel of a custom list: every level on the list, searchable, with
 * thumbnails — the same shape as the main list's nav so moving between the
 * two feels like one site.
 */
export type CustomItem = {
  id: number
  rank: number
  points: number
  name: string
  gd_id: number | null
  creator: string | null
  gddl_tier: string | null
  verification_url: string | null
  percent_to_qualify: number
  records: { id: number }[]
}

const props = defineProps<{
  items: CustomItem[]
  activeId?: number | null
  listPath: string
}>()

const search = ref('')
const scrollEl = ref<HTMLElement | null>(null)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.items
  // "#12" jumps by rank, otherwise match name or creator.
  const byRank = q.match(/^#(\d+)$/)
  if (byRank) return props.items.filter((i) => i.rank === Number(byRank[1]))
  return props.items.filter(
    (i) => i.name.toLowerCase().includes(q) || (i.creator ?? '').toLowerCase().includes(q),
  )
})

watch(
  () => props.activeId,
  async (id) => {
    if (id == null) return
    await nextTick()
    scrollEl.value?.querySelector<HTMLElement>(`[data-item="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800/80 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800/80 shrink-0">
      <div class="flex items-center gap-2 mb-2.5 px-1">
        <span class="text-[10px] uppercase tracking-widest text-accent font-semibold">Levels</span>
        <span class="text-[10px] text-zinc-600 tabular-nums ml-auto">{{ items.length }}</span>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search… name, creator, #rank"
        class="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="divide-y divide-zinc-900/60">
        <li v-for="lvl in filtered" :key="lvl.id" :data-item="lvl.id">
          <NuxtLink
            :to="`${listPath}/${lvl.rank}`"
            class="relative overflow-hidden flex items-center gap-2 pr-3 py-1.5 text-sm transition-colors group"
            :class="lvl.id === activeId ? '' : 'text-zinc-300 hover:bg-zinc-900/70'"
          >
            <LevelThumbBg
              :gd-id="lvl.gd_id"
              :video-url="lvl.verification_url"
              res="small"
              :img-class="lvl.id === activeId ? 'opacity-55' : 'opacity-25 group-hover:opacity-50'"
              overlay-class="bg-gradient-to-r from-zinc-950/92 via-zinc-950/60 to-zinc-950/20"
            />
            <span
              class="relative text-[11px] tabular-nums px-2 py-1 w-12 shrink-0 text-center font-semibold"
              :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
            >#{{ lvl.rank }}</span>
            <span class="relative flex-1 min-w-0">
              <span class="block truncate" :class="lvl.id === activeId ? 'text-accent font-medium' : ''">{{ lvl.name }}</span>
              <span v-if="lvl.creator" class="block truncate text-[10px] text-zinc-500">{{ lvl.creator }}</span>
            </span>
            <span class="relative shrink-0 text-[10px] tabular-nums text-amber-300/80">{{ lvl.points }}</span>
          </NuxtLink>
        </li>
        <li v-if="!filtered.length" class="px-3 py-6 text-xs text-zinc-500 text-center">No matches.</li>
      </ul>
    </div>
  </aside>
</template>
