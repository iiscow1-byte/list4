<script setup lang="ts">
type Record = {
  id?: number
  player: string
  country: string | number | null
  percent: number
  hz: number | null
  video: string | null
  source?: 'all' | 'aredl' | 'pointercrate'
  is_verification?: number | null
  is_legacy?: number | null
  demon_position?: number | null
}

const props = defineProps<{ records: Record[] }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const isAdmin = computed(() => {
  const role = meRes.value?.account?.role
  return role === 'admin' || role === 'owner' || role === 'developer'
})

type Filter = 'all' | 'site' | 'aredl' | 'pointercrate'
const filter = ref<Filter>('all')

const hasSite = computed(() => props.records.some((r) => !r.source || r.source === 'all'))
const hasAredl = computed(() => props.records.some((r) => r.source === 'aredl'))
const hasPc = computed(() => props.records.some((r) => r.source === 'pointercrate'))
// Filter chip row only renders when at least two sources are present.
const showFilter = computed(() => [hasSite.value, hasAredl.value, hasPc.value].filter(Boolean).length >= 2)

const visibleChips = computed<[Filter, string][]>(() => {
  const out: [Filter, string][] = [['all', 'All']]
  if (hasSite.value) out.push(['site', 'ALL'])
  if (hasAredl.value) out.push(['aredl', 'AREDL'])
  if (hasPc.value) out.push(['pointercrate', 'PC'])
  return out
})

const filtered = computed(() => {
  if (filter.value === 'site') return props.records.filter((r) => !r.source || r.source === 'all')
  if (filter.value === 'aredl') return props.records.filter((r) => r.source === 'aredl')
  if (filter.value === 'pointercrate') return props.records.filter((r) => r.source === 'pointercrate')
  return props.records
})

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
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2">
        Records
        <span class="ml-1 tabular-nums text-zinc-600">{{ props.records.length }}</span>
      </h2>
      <div v-if="showFilter" class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          v-for="[val, label] in visibleChips"
          :key="val"
          type="button"
          class="px-2.5 py-1 text-[10px] font-medium transition-colors"
          :class="filter === val ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="filter = val"
        >{{ label }}</button>
      </div>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="filtered.length === 0" class="p-6 text-center text-sm text-zinc-600">
        No records
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="(r, idx) in filtered"
          :key="`${r.source ?? 'all'}-${r.player}-${r.percent}-${idx}`"
          class="px-3 py-2.5 hover:bg-zinc-900/60 transition-colors group"
        >
          <!-- Line 1: player name · video link · percent · delete -->
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium truncate">{{ r.player }}</span>
            <div class="flex items-center gap-2 shrink-0">
              <a
                v-if="r.video"
                :href="r.video"
                target="_blank"
                rel="noopener"
                class="text-[11px] text-zinc-500 hover:text-accent transition-colors"
              >video ↗</a>
              <span class="tabular-nums text-xs text-amber-300">{{ r.percent }}%</span>
              <button
                v-if="isAdmin && r.id && (!r.source || r.source === 'all')"
                type="button"
                :disabled="deletingId != null"
                class="text-[10px] text-zinc-500 hover:text-red-400 disabled:opacity-30 transition-colors leading-none"
                title="Remove record"
                @click="deleteRecord(r.id!)"
              >✕</button>
            </div>
          </div>
          <!-- Line 2: country · hz · source badge (consistent for all records) -->
          <div class="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-500">
            <span v-if="r.country" class="uppercase">{{ r.country }}</span>
            <span v-if="r.hz" class="tabular-nums">{{ r.hz }}hz</span>
            <span
              v-if="!r.source || r.source === 'all'"
              class="text-[9px] uppercase tracking-wider px-1 py-px rounded bg-zinc-900 text-zinc-400"
              title="ALL list record"
            >ALL</span>
            <span
              v-if="r.source === 'aredl'"
              class="text-[9px] uppercase tracking-wider px-1 py-px rounded bg-zinc-900 text-zinc-400"
              :title="r.is_verification ? 'Verified on AREDL' : 'Imported from AREDL'"
            >AREDL</span>
            <span
              v-if="r.source === 'pointercrate'"
              class="text-[9px] uppercase tracking-wider px-1 py-px rounded bg-zinc-900 text-zinc-400"
              :title="r.is_legacy ? 'From Pointercrate Legacy' : (r.is_verification ? 'Verifier on Pointercrate' : 'Imported from Pointercrate')"
            >PC{{ r.is_legacy ? ' Legacy' : '' }}</span>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
