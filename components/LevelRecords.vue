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
  <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
    <div class="px-3 pt-3 pb-2.5 border-b border-zinc-800 shrink-0 space-y-2">
      <div class="flex items-baseline gap-2">
        <h2 class="font-display font-semibold text-zinc-50">Records</h2>
        <span class="text-xs text-zinc-500 tabular-nums">
          {{ filtered.length }}<template v-if="filtered.length !== records.length"> of {{ records.length }}</template>
        </span>
      </div>
      <SegmentedControl
        v-if="showFilter"
        v-model="filterModel"
        aria-label="Which list these records came from"
        :options="visibleChips"
      />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="records.length === 0" class="px-4 py-8 text-center text-sm text-zinc-500">
        No records yet.
      </p>
      <div v-else-if="filtered.length === 0" class="px-4 py-8 text-center text-sm text-zinc-500">
        None from that list.
        <button type="button" class="block mx-auto mt-1 link text-xs" @click="filter = 'all'">Show all {{ records.length }}</button>
      </div>

      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="(r, idx) in filtered"
          :key="`${r.source ?? 'all'}-${r.player}-${r.percent}-${idx}`"
          class="px-3 py-2 hover:bg-zinc-900/50 transition-colors group"
        >
          <div class="flex items-center gap-2 min-w-0">
            <CountryFlag :country="typeof r.country === 'number' ? String(r.country) : r.country" size="sm" />
            <NuxtLink
              :to="`/users/by-player/${encodeURIComponent(r.player)}`"
              class="text-sm font-medium truncate text-zinc-100 hover:text-accent transition-colors min-w-0"
              :title="r.player"
            >{{ r.player }}</NuxtLink>
            <ClanTag v-if="r.clan" :tag="r.clan.tag" :name="r.clan.name" :color="r.clan.color" size="sm" />
            <span
              class="ml-auto shrink-0 text-sm tabular-nums font-semibold"
              :class="r.percent >= 100 ? 'text-zinc-50' : 'text-zinc-400'"
            >{{ r.percent }}%</span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span :title="sourceBadge(r).title">{{ sourceBadge(r).label }}</span>
            <span v-if="r.is_verification" class="text-emerald-400">Verification</span>
            <span v-if="r.mobile">Mobile</span>
            <span v-if="r.hz" class="tabular-nums">{{ r.hz }} Hz</span>
            <a
              v-if="r.video"
              :href="r.video"
              target="_blank"
              rel="noopener"
              class="ml-auto shrink-0 hover:text-accent transition-colors"
            >Video</a>
            <button
              v-if="isAdmin && r.id && bucket(r) === 'site'"
              type="button"
              :disabled="deletingId != null"
              class="shrink-0 text-zinc-600 hover:text-red-300 disabled:opacity-30 sm:opacity-0 group-hover:opacity-100 focus:opacity-100"
              :class="r.video ? '' : 'ml-auto'"
              aria-label="Remove this record"
              title="Remove this record"
              @click="deleteRecord(r.id!)"
            >Remove</button>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
