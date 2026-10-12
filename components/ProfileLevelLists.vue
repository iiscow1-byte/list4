<script setup lang="ts">
/**
 * What a player has done, on their profile: completed, verified, created.
 *
 * One card with three tabs rather than three stacked cards. The old shape
 * printed every row of all three — a player with 300 completions pushed the
 * comments below them off the bottom of a very long page, and the two short
 * lists people actually read were somewhere in the middle of it. Only the tabs
 * with something in them are offered, so a profile never shows an empty one.
 */
type ListLevelRow = {
  position: number
  sheet_placement?: number | null
  name: string
  points: number | null
  gddl_tier: string | null
  gd_id?: number | null
}
type CompletedLevel = ListLevelRow & {
  percent: number
  record_id?: number
  video?: string | null
  main_skillset?: string | null
}

const props = defineProps<{
  completed?: CompletedLevel[]
  created?: ListLevelRow[]
  verified?: ListLevelRow[]
}>()

const emit = defineEmits<{ (e: 'refresh'): void }>()

const showThumbs = useShowThumbnails()

const { data: meRes } = useCurrentUser()
const isAdmin = computed(() => {
  const role = meRes.value?.account?.role
  return role === 'admin' || role === 'owner' || role === 'developer'
})

type Tab = { key: 'completed' | 'verified' | 'created'; label: string; rows: ListLevelRow[] }
const tabs = computed<Tab[]>(() => ([
  { key: 'completed', label: 'Completed', rows: props.completed ?? [] },
  { key: 'verified', label: 'Verified', rows: props.verified ?? [] },
  { key: 'created', label: 'Created', rows: props.created ?? [] },
] as Tab[]).filter((t) => t.rows.length > 0))

/**
 * The chosen tab, if it still exists. Deleting the last record of a tab drops
 * it from the strip, and the selection has to land somewhere real rather than
 * on a tab that is no longer offered.
 */
const chosen = ref<Tab['key']>('completed')
const active = computed<Tab | null>(
  () => tabs.value.find((t) => t.key === chosen.value) ?? tabs.value[0] ?? null,
)
const chosenModel = computed({
  get: () => active.value?.key ?? chosen.value,
  set: (v: string) => { chosen.value = v as Tab['key'] },
})

const query = ref('')
/** Long lists open at a readable length; the rest is one click away. */
const PAGE = 25
const expanded = ref(false)
watch([chosen, query], () => { expanded.value = false })

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  const rows = active.value?.rows ?? []
  if (!q) return rows
  return rows.filter((l) => l.name.toLowerCase().includes(q))
})
const shown = computed(() => (expanded.value ? matches.value : matches.value.slice(0, PAGE)))
const hidden = computed(() => Math.max(0, matches.value.length - shown.value.length))

/** Completed rows carry a percent, a video and — for admins — a delete. */
function asCompleted(l: ListLevelRow): CompletedLevel | null {
  return active.value?.key === 'completed' ? (l as CompletedLevel) : null
}

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

function fmt(n: number | null) {
  if (n == null) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}
</script>

<template>
  <section v-if="tabs.length" class="card overflow-hidden">
    <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-zinc-800/80">
      <SegmentedControl
        v-model="chosenModel"
        aria-label="Which levels"
        :options="tabs.map((t) => ({ value: t.key, label: t.label, count: t.rows.length }))"
      />
      <!-- Only worth a search box once scrolling for a level is the alternative. -->
      <input
        v-if="(active?.rows.length ?? 0) > 12"
        v-model="query"
        type="search"
        placeholder="Find a level"
        aria-label="Find a level"
        class="field field-sm ml-auto w-36 sm:w-48"
      />
    </div>

    <ul v-if="shown.length" class="p-1.5 space-y-1">
      <li
        v-for="l in shown"
        :key="`${active?.key}-${l.position}`"
        class="flex items-center gap-1.5"
      >
        <LevelRow
          class="flex-1 min-w-0"
          :to="`/levels/${l.position}`"
          :rank="`#${l.position}`"
          :name="l.name"
          :tier="l.gddl_tier"
          :gd-id="l.gd_id"
          :video-url="asCompleted(l)?.video"
          :thumbs="showThumbs"
        >
          <template #trailing>
            <span
              v-if="asCompleted(l) && asCompleted(l)!.percent < 100"
              class="tabular-nums text-[11px] text-zinc-400"
            >{{ asCompleted(l)!.percent }}%</span>
            <span class="tabular-nums text-xs text-amber-300">{{ fmt(l.points) }}</span>
          </template>
        </LevelRow>
        <a
          v-if="asCompleted(l)?.video"
          :href="asCompleted(l)!.video!"
          target="_blank"
          rel="noopener"
          class="shrink-0 w-6 text-center text-xs text-zinc-500 hover:text-accent transition-colors"
          :title="`Watch ${l.name}`"
          :aria-label="`Watch ${l.name}`"
        >↗</a>
        <button
          v-if="isAdmin && asCompleted(l)?.record_id"
          type="button"
          :disabled="deletingId != null"
          class="shrink-0 w-6 text-xs text-zinc-500 hover:text-red-400 disabled:opacity-30 transition-colors"
          title="Remove record"
          aria-label="Remove record"
          @click="deleteRecord(asCompleted(l)!.record_id!)"
        >✕</button>
      </li>
    </ul>
    <p v-else class="px-4 py-6 text-center text-sm text-zinc-500">
      No levels match “{{ query.trim() }}”.
    </p>

    <button
      v-if="hidden"
      type="button"
      class="w-full px-4 py-2.5 text-xs text-zinc-500 hover:text-accent hover:bg-zinc-900/40 border-t border-zinc-900 transition-colors"
      @click="expanded = true"
    >Show {{ hidden.toLocaleString() }} more</button>
  </section>
</template>
