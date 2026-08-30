<script setup lang="ts">
import { recordSource, recordSourceBadge, sortRecords } from '~/utils/level-records'

/**
 * Everybody who has beaten this level, in the list's right-hand column.
 *
 * Three things were wrong with it, and they were all the same thing: the panel
 * treated a record as a row of text rather than as a person.
 *
 * - **The names weren't links.** This is the densest list of player names on the
 *   site and none of them went anywhere, on a site whose whole point is those
 *   players' profiles.
 * - **The country was a bare two-letter code** — `US`, `GB` — while every other
 *   place the site prints a country draws the flag.
 * - **The order was by import source**, so the site's own records came first,
 *   then AREDL's, then Pointercrate's, each sorted separately. A 60% attempt on
 *   the sheet sat above a verified 100% from AREDL. Percent decides now, and
 *   the source only breaks ties.
 *
 * The type is `LevelRecord` rather than `Record` because the old name shadowed
 * TypeScript's built-in `Record<K, V>` for the whole file — which is fine until
 * the day somebody wants a map in here and gets an incomprehensible error.
 */
type LevelRecord = {
  id?: number
  player: string
  country: string | number | null
  percent: number
  hz: number | null
  video: string | null
  source?: 'all' | 'aredl' | 'pointercrate'
  is_verification?: number | null
  is_legacy?: number | null
  mobile?: number | null
  demon_position?: number | null
  achieved_at?: string | null
  clan?: { tag: string; name: string; color: string | null } | null
}

const props = defineProps<{ records: LevelRecord[] }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const isAdmin = computed(() => {
  const role = meRes.value?.account?.role
  return role === 'admin' || role === 'owner' || role === 'developer'
})

type Filter = 'all' | 'site' | 'aredl' | 'pointercrate'
const filter = ref<Filter>('all')

/** Which bucket a row belongs to. A missing source is the site's own list. */
const bucket = recordSource

const counts = computed(() => {
  const out = { site: 0, aredl: 0, pointercrate: 0 }
  for (const r of props.records) out[bucket(r)]++
  return out
})

/** The chip row only renders when at least two sources are present. */
type Chip = { value: Filter; label: string; count: number; title: string }
const visibleChips = computed<Chip[]>(() => {
  const chip = (value: Filter, label: string, count: number): Chip => ({
    value, label, count,
    title: `${count} record${count === 1 ? '' : 's'}`,
  })
  const out: Chip[] = [chip('all', 'All', props.records.length)]
  if (counts.value.site) out.push(chip('site', 'ALL', counts.value.site))
  if (counts.value.aredl) out.push(chip('aredl', 'AREDL', counts.value.aredl))
  if (counts.value.pointercrate) out.push(chip('pointercrate', 'PC', counts.value.pointercrate))
  return out
})
const filterModel = computed({
  get: () => filter.value as string,
  set: (v: string) => { filter.value = v as Filter },
})
const showFilter = computed(() => visibleChips.value.length >= 3)

/** Sorted by what the record *is*, not by where it was imported from. */
const filtered = computed(() => sortRecords(
  filter.value === 'all'
    ? props.records
    : props.records.filter((r) => bucket(r) === filter.value),
))

const sourceBadge = recordSourceBadge

const deletingId = ref<number | null>(null)
async function deleteRecord(id: number) {
  if (deletingId.value != null) return
  deletingId.value = id
  try {
    await $fetch(`/api/admin/records/${id}`, { method: 'DELETE' })
    emit('refresh')
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <aside class="flex flex-col min-h-0 border-l border-zinc-800/80 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800/80 shrink-0">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2 flex items-baseline gap-1.5">
        Records
        <!-- The total was printed here while the list below was filtered, so
             the heading disagreed with what was under it. It says what you are
             looking at, and how many there are in all when those differ. -->
        <span class="tabular-nums text-zinc-600">{{ filtered.length }}</span>
        <span
          v-if="filtered.length !== records.length"
          class="tabular-nums text-zinc-700"
        >of {{ records.length }}</span>
      </h2>
      <SegmentedControl
        v-if="showFilter"
        v-model="filterModel"
        aria-label="Which list these records came from"
        :options="visibleChips"
      />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="records.length === 0" class="p-6 text-center text-sm text-zinc-600">
        No records yet.
      </div>
      <div v-else-if="filtered.length === 0" class="p-6 text-center text-sm text-zinc-600">
        Nothing from that list.
        <button type="button" class="block mx-auto mt-1 text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" @click="filter = 'all'">
          Show all {{ records.length }}
        </button>
      </div>

      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="(r, idx) in filtered"
          :key="`${r.source ?? 'all'}-${r.player}-${r.percent}-${idx}`"
          class="px-3 py-2 hover:bg-zinc-900/60 transition-colors group"
        >
          <!-- Line 1: who, and how far they got -->
          <div class="flex items-baseline gap-2">
            <CountryFlag :country="typeof r.country === 'number' ? String(r.country) : r.country" size="sm" class="self-center" />
            <NuxtLink
              :to="`/users/by-player/${encodeURIComponent(r.player)}`"
              class="text-sm font-medium truncate text-zinc-200 hover:text-accent transition-colors min-w-0"
              :title="r.player"
            >{{ r.player }}</NuxtLink>
            <ClanTag v-if="r.clan" :tag="r.clan.tag" :name="r.clan.name" :color="r.clan.color" size="sm" class="self-center" />
            <span
              class="ml-auto tabular-nums text-xs shrink-0"
              :class="r.percent >= 100 ? 'text-amber-300' : 'text-zinc-400'"
            >{{ r.percent }}%</span>
          </div>

          <!-- Line 2: where it came from, and what else is known about it -->
          <div class="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-zinc-500">
            <Badge tone="quiet" size="sm" :title="sourceBadge(r).title">{{ sourceBadge(r).label }}</Badge>
            <Badge v-if="r.is_verification" tone="emerald" size="sm" title="This is the level's verification">Verifier</Badge>
            <Badge v-if="r.mobile" tone="sky" size="sm" title="Beaten on mobile">Mobile</Badge>
            <span v-if="r.hz" class="tabular-nums shrink-0">{{ r.hz }}hz</span>
            <a
              v-if="r.video"
              :href="r.video"
              target="_blank"
              rel="noopener"
              class="ml-auto shrink-0 text-zinc-500 hover:text-accent transition-colors"
            >video ↗</a>
            <!-- Hidden until the row is hovered or the button is focused: it is
                 a destructive control on every row of a long list, and it has
                 to stay reachable from the keyboard. -->
            <button
              v-if="isAdmin && r.id && bucket(r) === 'site'"
              type="button"
              :disabled="deletingId != null"
              class="shrink-0 text-[10px] leading-none text-zinc-600 hover:text-red-400 disabled:opacity-30 transition-all sm:opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              :class="r.video ? '' : 'ml-auto'"
              aria-label="Remove this record"
              title="Remove this record"
              @click="deleteRecord(r.id!)"
            >✕</button>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
